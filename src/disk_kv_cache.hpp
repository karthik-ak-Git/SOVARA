#pragma once
#include <string>
#include <vector>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <atomic>
#ifdef _WIN32
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

template<typename T, size_t Align>
struct AlignedAllocator {
  using value_type = T;
  AlignedAllocator() noexcept {}
  template<typename U> AlignedAllocator(const AlignedAllocator<U,Align>&) noexcept {}
  T* allocate(size_t n){ void* p=null;
#ifdef _WIN32
    p=_aligned_malloc(n*sizeof(T), Align);
    if(!p) throw std::bad_alloc();
#else
    if(posix_memalign(&p, Align, n*sizeof(T))!=0) throw std::bad_alloc();
#endif
    return reinterpret_cast<T*>(p);
  }
  void deallocate(T* p, size_t){ 
#ifdef _WIN32
    _aligned_free(p);
#else
    free(p);
#endif
  }
  bool operator==(const AlignedAllocator&) const noexcept { return true; }
  bool operator!=(const AlignedAllocator&) const noexcept { return false; }
};

struct KVCacheBlock {
  size_t layer_id = 0;
  std::vector<char, AlignedAllocator<char,4096>> data;
  std::atomic<bool> is_ready{false};
  KVCacheBlock(){}
};

class DiskKVCacheManager {
public:
  DiskKVCacheManager(std::string path, size_t b_size, size_t layers);
  ~DiskKVCacheManager();
  char* GetLayerKV(size_t layer_id);
  void ReleaseLayer(size_t layer_id);
private:
  void prefetch_loop();
  std::string file_path;
  size_t block_size;
  size_t total_layers;
  std::atomic<size_t> current_layer{0};
  std::vector<char, AlignedAllocator<char,4096>> buf_a;
  std::vector<char, AlignedAllocator<char,4096>> buf_b;
  char* front_buf = nullptr;
  char* back_buf = nullptr;
  std::atomic<size_t> front_layer{SIZE_MAX};
  std::atomic<size_t> back_layer{SIZE_MAX};
  std::atomic<bool> front_ready{false};
  std::atomic<bool> back_ready{false};
#ifdef _WIN32
  HANDLE file_handle = INVALID_HANDLE_VALUE;
#else
  int file_descriptor = -1;
#endif
  std::mutex mtx;
  std::condition_variable cv_disk;
  std::condition_variable cv_engine;
  std::thread worker_thread;
  std::atomic<bool> stop_signal{false};
};
