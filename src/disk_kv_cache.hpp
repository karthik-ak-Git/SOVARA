// disk_kv_cache.hpp — Layer-Ahead Disk-Pre-fetching KV-Cache Engine.
//
// Streams llama.cpp KV-cache blocks straight from NVMe into page-aligned
// recycling double buffers in system RAM (Direct I/O — no OS page cache),
// staying exactly one layer ahead of inference. Blocks the execution thread
// ONLY when disk throughput falls behind the engine.
//
// Thread model:
//   engine thread : GetLayerKV(layer) → wait on cv_engine → consume → ReleaseLayer
//   disk thread   : prefetch_loop() → read layer N+1 into the back buffer → flip
//
// Alignment contract: every buffer is 4096-byte page aligned (mandatory for
// O_DIRECT on Linux and FILE_FLAG_NO_BUFFERING on Windows), and every read
// size/offset is a multiple of 4096.
#pragma once

#include <cstddef>
#include <condition_variable>
#include <atomic>
#include <mutex>
#include <string>
#include <thread>

#ifdef _WIN32
  #ifndef WIN32_LEAN_AND_MEAN
    #define WIN32_LEAN_AND_MEAN
  #endif
  #ifndef NOMINMAX
    #define NOMINMAX
  #endif
  #include <windows.h>
#else
  #include <fcntl.h>
  #include <unistd.h>
#endif

// Page-aligned raw allocation helpers (Direct I/O requires 4096 alignment).
void* aligned_alloc_pages(size_t size);          // throws std::bad_alloc
void  aligned_free_pages(void* ptr) noexcept;

struct KVCacheBlock {
  std::size_t layer_id = 0;
  void*       data     = nullptr;   // page-aligned, block_size bytes, owned
  std::size_t bytes    = 0;
  std::atomic<bool> is_ready{ false };

  KVCacheBlock() = default;
  ~KVCacheBlock();
  KVCacheBlock(const KVCacheBlock&) = delete;
  KVCacheBlock& operator=(const KVCacheBlock&) = delete;
  KVCacheBlock(KVCacheBlock&& other) noexcept;
  KVCacheBlock& operator=(KVCacheBlock&& other) noexcept;
};

class DiskKVCacheManager {
public:
  // Opens `path` with platform Direct-I/O flags and starts the prefetch thread.
  // Throws std::runtime_error when the file cannot be opened or block_size is
  // not 4096-aligned. `layers` is the KV layer count of the loaded model.
  DiskKVCacheManager(std::string path, std::size_t b_size, std::size_t layers);

  // RAII: signals stop, wakes both CVs, joins the worker, closes the handle.
  ~DiskKVCacheManager();

  DiskKVCacheManager(const DiskKVCacheManager&) = delete;
  DiskKVCacheManager& operator=(const DiskKVCacheManager&) = delete;

  // Returns a page-aligned buffer holding layer `layer_id`'s KV bytes.
  // Blocks until the data is resident. If the prefetcher already loaded it
  // (layer-ahead), this returns immediately — RAM-level latency.
  char* GetLayerKV(std::size_t layer_id);

  // Marks `layer_id` consumed so the buffer slot can be recycled by the
  // prefetcher. Call after the layer's inference step finishes.
  void ReleaseLayer(std::size_t layer_id);

  // Telemetry for the UI state matrix.
  double disk_read_mbps() const noexcept { return disk_read_mbps_.load(std::memory_order_relaxed); }
  std::size_t prefetched_layer() const noexcept { return prefetched_layer_.load(std::memory_order_relaxed); }
  std::size_t current_layer() const noexcept { return current_layer_.load(std::memory_order_relaxed); }
  std::size_t total_layers() const noexcept { return total_layers_; }
  std::size_t block_bytes() const noexcept { return block_size_; }

private:
  void prefetch_loop();
  bool read_layer_into(void* dst, std::size_t layer_id) noexcept;
  void close_handle() noexcept;

  std::string file_path_;
  std::size_t block_size_   = 0;   // bytes per layer block (4096-aligned)
  std::size_t total_layers_ = 0;
  std::size_t aligned_size_ = 0;   // block_size_ rounded up to 4096

  // Engine pointer + the two recycling buffers. front_ serves the engine,
  // back_ is what the disk thread is (or just finished) filling.
  std::atomic<std::size_t> current_layer_{ 0 };
  std::atomic<std::size_t> prefetched_layer_{ static_cast<std::size_t>(-1) };
  void*  front_buf_ = nullptr;
  void*  back_buf_  = nullptr;
  std::atomic<std::size_t> front_layer_{ static_cast<std::size_t>(-1) };
  std::atomic<std::size_t> back_layer_{ static_cast<std::size_t>(-1) };
  std::atomic<bool> front_ready_{ false };
  std::atomic<bool> back_ready_{ false };

  // Telemetry (relaxed — UI only).
  std::atomic<double> disk_read_mbps_{ 0.0 };
  std::atomic<std::uint64_t> bytes_read_{ 0 };
  std::atomic<std::uint64_t> last_read_ms_{ 0 };

#ifdef _WIN32
  HANDLE file_handle_ = INVALID_HANDLE_VALUE;
#else
  int    file_descriptor_ = -1;
#endif

  // Sync: mtx_ guards buffer slot swaps; cv_disk_ wakes the disk thread when
  // the engine advances or stops; cv_engine_ wakes the engine when its layer
  // is resident. stop_signal_ terminates the loop.
  std::mutex mtx_;
  std::condition_variable cv_disk_;
  std::condition_variable cv_engine_;
  std::thread worker_thread_;
  std::atomic<bool> stop_signal_{ false };
};
