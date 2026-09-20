// disk_kv_cache.cpp — Layer-Ahead Disk-Pre-fetching KV-Cache Engine (impl).
//
// Windows : CreateFileA(FILE_FLAG_NO_BUFFERING | FILE_FLAG_WRITE_THROUGH) +
//           ReadFile with an OVERLAPPED carrying the 64-bit file offset.
// POSIX   : open(O_RDONLY | O_DIRECT) + pread() at explicit offsets.
// Memory  : _aligned_malloc / posix_memalign at 4096 — Direct I/O mandatory.
//
// Pipeline invariant: when the engine consumes layer N, the disk thread is
// streaming layer N+1 into the alternate buffer. The engine blocks ONLY when
// the disk falls behind (cv_engine wait), never when prefetch is on time.

#include "disk_kv_cache.hpp"

#include <chrono>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <new>

#ifdef _WIN32
  #include <io.h>
#else
  #include <cerrno>
#endif

// ── Aligned allocation (Direct I/O requires page alignment) ──────────────

void* aligned_alloc_pages(size_t size) {
  if (size == 0) return nullptr;
#ifdef _WIN32
  void* p = _aligned_malloc(size, 4096);
  if (p == nullptr) throw std::bad_alloc();
  return p;
#else
  void* p = nullptr;
  if (posix_memalign(&p, 4096, size) != 0) throw std::bad_alloc();
  return p;
#endif
}

void aligned_free_pages(void* ptr) noexcept {
  if (ptr == nullptr) return;
#ifdef _WIN32
  _aligned_free(ptr);
#else
  free(ptr);
#endif
}

// ── KVCacheBlock RAII ─────────────────────────────────────────────────────

KVCacheBlock::~KVCacheBlock() {
  aligned_free_pages(data);
  data = nullptr;
  bytes = 0;
}

KVCacheBlock::KVCacheBlock(KVCacheBlock&& other) noexcept
  : layer_id(other.layer_id), data(other.data), bytes(other.bytes),
    is_ready(other.is_ready.load()) {
  other.data = nullptr;
  other.bytes = 0;
  other.layer_id = 0;
}

KVCacheBlock& KVCacheBlock::operator=(KVCacheBlock&& other) noexcept {
  if (this != &other) {
    aligned_free_pages(data);
    data = other.data; other.data = nullptr;
    bytes = other.bytes; other.bytes = 0;
    layer_id = other.layer_id; other.layer_id = 0;
    is_ready.store(other.is_ready.load());
  }
  return *this;
}

// ── Construction / destruction ────────────────────────────────────────────

DiskKVCacheManager::DiskKVCacheManager(std::string path, size_t b_size, size_t layers)
  : file_path_(std::move(path)), block_size_(b_size), total_layers_(layers) {
  if (block_size_ == 0) throw std::runtime_error("disk_kv_cache: block_size must be > 0");
  // Direct I/O reads must be sector multiples; force 4096 alignment.
  aligned_size_ = ((block_size_ + 4095) / 4096) * 4096;
  block_size_ = aligned_size_;

  front_buf_ = aligned_alloc_pages(aligned_size_);
  back_buf_  = aligned_alloc_pages(aligned_size_);
  std::memset(front_buf_, 0, aligned_size_);
  std::memset(back_buf_, 0, aligned_size_);

#ifdef _WIN32
  file_handle_ = CreateFileA(
      file_path_.c_str(),
      GENERIC_READ,
      FILE_SHARE_READ,
      nullptr,
      OPEN_EXISTING,
      FILE_FLAG_NO_BUFFERING | FILE_FLAG_WRITE_THROUGH,
      nullptr);
  if (file_handle_ == INVALID_HANDLE_VALUE) {
    aligned_free_pages(front_buf_); front_buf_ = nullptr;
    aligned_free_pages(back_buf_);  back_buf_ = nullptr;
    throw std::runtime_error("disk_kv_cache: CreateFileA failed for " + file_path_);
  }
#else
  file_descriptor_ = ::open(file_path_.c_str(), O_RDONLY | O_DIRECT);
  if (file_descriptor_ < 0) {
    // Some filesystems (tmpfs, ZFS) reject O_DIRECT — retry buffered so the
    // engine still runs, at OS-cache speed instead of failing hard.
    file_descriptor_ = ::open(file_path_.c_str(), O_RDONLY);
    if (file_descriptor_ < 0) {
      aligned_free_pages(front_buf_); front_buf_ = nullptr;
      aligned_free_pages(back_buf_);  back_buf_ = nullptr;
      throw std::runtime_error("disk_kv_cache: open failed for " + file_path_);
    }
  }
#endif

  worker_thread_ = std::thread(&DiskKVCacheManager::prefetch_loop, this);
}

DiskKVCacheManager::~DiskKVCacheManager() {
  stop_signal_.store(true, std::memory_order_release);
  cv_disk_.notify_all();
  cv_engine_.notify_all();
  if (worker_thread_.joinable()) worker_thread_.join();
  close_handle();
  aligned_free_pages(front_buf_); front_buf_ = nullptr;
  aligned_free_pages(back_buf_);  back_buf_ = nullptr;
}

void DiskKVCacheManager::close_handle() noexcept {
#ifdef _WIN32
  if (file_handle_ != INVALID_HANDLE_VALUE) {
    CloseHandle(file_handle_);
    file_handle_ = INVALID_HANDLE_VALUE;
  }
#else
  if (file_descriptor_ >= 0) {
    ::close(file_descriptor_);
    file_descriptor_ = -1;
  }
#endif
}

// ── Engine API ────────────────────────────────────────────────────────────

char* DiskKVCacheManager::GetLayerKV(size_t layer_id) {
  if (layer_id >= total_layers_) throw std::runtime_error("disk_kv_cache: layer out of range");
  {
    std::lock_guard<std::mutex> lk(mtx_);
    current_layer_.store(layer_id, std::memory_order_release);
  }
  cv_disk_.notify_one();

  // Fast path: the prefetcher already made this layer resident (layer-ahead).
  if (front_ready_.load(std::memory_order_acquire) &&
      front_layer_.load(std::memory_order_acquire) == layer_id) {
    return static_cast<char*>(front_buf_);
  }
  // The back buffer may already hold it — swap slots instead of re-reading.
  if (back_ready_.load(std::memory_order_acquire) &&
      back_layer_.load(std::memory_order_acquire) == layer_id) {
    std::lock_guard<std::mutex> lk(mtx_);
    void* tf = front_buf_; front_buf_ = back_buf_; back_buf_ = tf;
    const bool tr = front_ready_.load(); front_ready_.store(back_ready_.load()); back_ready_.store(tr);
    const size_t tl = front_layer_.load(); front_layer_.store(back_layer_.load()); back_layer_.store(tl);
    return static_cast<char*>(front_buf_);
  }

  // Slow path: disk is behind — wait until the prefetcher publishes this layer.
  std::unique_lock<std::mutex> lk(mtx_);
  cv_engine_.wait(lk, [&] {
    return stop_signal_.load(std::memory_order_acquire) ||
           (front_ready_.load(std::memory_order_acquire) &&
            front_layer_.load(std::memory_order_acquire) == layer_id);
  });
  if (stop_signal_.load(std::memory_order_acquire)) {
    throw std::runtime_error("disk_kv_cache: manager stopped during GetLayerKV");
  }
  return static_cast<char*>(front_buf_);
}

void DiskKVCacheManager::ReleaseLayer(size_t layer_id) {
  (void)layer_id;
  // Slot recycling happens implicitly: the prefetcher overwrites whichever
  // buffer is not currently serving the engine. Waking the disk thread here
  // lets it start the next layer as early as possible.
  cv_disk_.notify_one();
}

// ── Direct-I/O read helpers ───────────────────────────────────────────────

bool DiskKVCacheManager::read_layer_into(void* dst, size_t layer_id) noexcept {
  const unsigned long long offset =
      static_cast<unsigned long long>(layer_id) * static_cast<unsigned long long>(block_size_);
#ifdef _WIN32
  OVERLAPPED ov{};
  ov.Offset     = static_cast<DWORD>(offset & 0xFFFFFFFFULL);
  ov.OffsetHigh = static_cast<DWORD>(offset >> 32);
  DWORD got = 0;
  const BOOL ok = ReadFile(file_handle_, dst, static_cast<DWORD>(block_size_), &got, &ov);
  if (!ok) {
    const DWORD err = GetLastError();
    if (err != ERROR_IO_PENDING) return false;
    if (!GetOverlappedResult(file_handle_, &ov, &got, TRUE)) return false;
  }
  return got == static_cast<DWORD>(block_size_);
#else
  size_t done = 0;
  const char* base = static_cast<const char*>(dst);
  while (done < block_size_) {
    const ssize_t r = ::pread(file_descriptor_,
                              const_cast<char*>(base) + done,
                              block_size_ - done,
                              static_cast<off_t>(offset) + static_cast<off_t>(done));
    if (r < 0) {
      if (errno == EINTR) continue;
      return false;
    }
    if (r == 0) return false; // EOF — cache file shorter than expected
    done += static_cast<size_t>(r);
  }
  return true;
#endif
}

// ── Prefetch pipeline (disk thread) ───────────────────────────────────────

void DiskKVCacheManager::prefetch_loop() {
  auto last_mark = std::chrono::steady_clock::now();
  std::uint64_t window_bytes = 0;

  while (!stop_signal_.load(std::memory_order_acquire)) {
    const size_t cur = current_layer_.load(std::memory_order_acquire);

    // 1) Serve the engine's layer first if the front slot doesn't hold it.
    if (!front_ready_.load(std::memory_order_acquire) ||
        front_layer_.load(std::memory_order_acquire) != cur) {
      // The back slot might already hold it — flip instead of re-reading.
      if (back_ready_.load(std::memory_order_acquire) &&
          back_layer_.load(std::memory_order_acquire) == cur) {
        std::lock_guard<std::mutex> lk(mtx_);
        void* tf = front_buf_; front_buf_ = back_buf_; back_buf_ = tf;
        const bool tr = front_ready_.load(); front_ready_.store(back_ready_.load()); back_ready_.store(tr);
        const size_t tl = front_layer_.load(); front_layer_.store(back_layer_.load()); back_layer_.store(tl);
      } else {
        if (read_layer_into(front_buf_, cur)) {
          front_layer_.store(cur, std::memory_order_release);
          front_ready_.store(true, std::memory_order_release);
        } else {
          front_ready_.store(false, std::memory_order_release);
        }
      }
      cv_engine_.notify_all();
    }

    // 2) Layer-ahead: stream cur+1 into the back slot while the engine runs.
    const size_t nxt = (cur + 1 < total_layers_) ? cur + 1 : cur;
    if (nxt != cur &&
        (!back_ready_.load(std::memory_order_acquire) ||
         back_layer_.load(std::memory_order_acquire) != nxt)) {
      const auto t0 = std::chrono::steady_clock::now();
      if (read_layer_into(back_buf_, nxt)) {
        const auto t1 = std::chrono::steady_clock::now();
        const double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
        window_bytes += block_size_;
        bytes_read_.fetch_add(block_size_, std::memory_order_relaxed);
        last_read_ms_.store(static_cast<std::uint64_t>(ms), std::memory_order_relaxed);
        back_layer_.store(nxt, std::memory_order_release);
        back_ready_.store(true, std::memory_order_release);
        prefetched_layer_.store(nxt, std::memory_order_release);
        const auto now = std::chrono::steady_clock::now();
        const double win_ms = std::chrono::duration<double, std::milli>(now - last_mark).count();
        if (win_ms >= 500.0) {
          const double mbps = (static_cast<double>(window_bytes) / (1024.0 * 1024.0)) / (win_ms / 1000.0);
          disk_read_mbps_.store(mbps, std::memory_order_relaxed);
          last_mark = now;
          window_bytes = 0;
        }
      } else {
        back_ready_.store(false, std::memory_order_release);
      }
    }

    // 3) Idle park — wake on engine advance, release, or shutdown.
    std::unique_lock<std::mutex> lk(mtx_);
    cv_disk_.wait_for(lk, std::chrono::milliseconds(5), [&] {
      return stop_signal_.load(std::memory_order_acquire) ||
             current_layer_.load(std::memory_order_acquire) != cur;
    });
  }
}
