#include "disk_kv_cache.hpp"
#include <cstring>
#include <stdexcept>

DiskKVCacheManager::DiskKVCacheManager(std::string path, size_t b_size, size_t layers)
: file_path(std::move(path)), block_size(b_size), total_layers(layers) {
  size_t aligned = ((b_size + 4095)/4096)*4096;
  buf_a.resize(aligned);
  buf_b.resize(aligned);
  front_buf = buf_a.data();
  back_buf = buf_b.data();
#ifdef _WIN32
  file_handle = CreateFileA(file_path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_FLAG_NO_BUFFERING | FILE_FLAG_WRITE_THROUGH, nullptr);
  if(file_handle==INVALID_HANDLE_VALUE) throw std::runtime_error("CreateFileA failed");
#else
  file_descriptor = open(file_path.c_str(), O_RDONLY | O_DIRECT);
  if(file_descriptor<0) throw std::runtime_error("open O_DIRECT failed");
#endif
  worker_thread = std::thread(&DiskKVCacheManager::prefetch_loop, this);
}

DiskKVCacheManager::~DiskKVCacheManager(){
  stop_signal.store(true);
  cv_disk.notify_all();
  cv_engine.notify_all();
  if(worker_thread.joinable()) worker_thread.join();
#ifdef _WIN32
  if(file_handle!=INVALID_HANDLE_VALUE) CloseHandle(file_handle);
#else
  if(file_descriptor>=0) close(file_descriptor);
#endif
}

char* DiskKVCacheManager::GetLayerKV(size_t layer_id){
  std::unique_lock<std::mutex> lk(mtx);
  current_layer.store(layer_id);
  cv_disk.notify_one();
  // wait until front holds requested layer
  cv_engine.wait(lk, [&]{ return front_ready.load() && front_layer.load()==layer_id; });
  return front_buf;
}
void DiskKVCacheManager::ReleaseLayer(size_t layer_id){
  (void)layer_id;
}

void DiskKVCacheManager::prefetch_loop(){
  while(!stop_signal.load()){
    size_t cur = current_layer.load();
    size_t need = cur;
    size_t pre = (cur+1 < total_layers) ? cur+1 : cur;
    // load need into front, pre into back (double buffer)
    auto loadInto = [&](char* dst, size_t layer){
#ifdef _WIN32
      LARGE_INTEGER off; off.QuadPart = (LONGLONG)layer * (LONGLONG)block_size;
      OVERLAPPED ov{}; ov.Offset = off.LowPart; ov.OffsetHigh = off.HighPart;
      DWORD read=0;
      if(!ReadFile(file_handle, dst, (DWORD)block_size, &read, &ov)){
        if(GetLastError()!=ERROR_IO_PENDING) return;
        GetOverlappedResult(file_handle, &ov, &read, TRUE);
      }
#else
      ssize_t r = pread(file_descriptor, dst, block_size, (off_t)layer * (off_t)block_size);
      (void)r;
#endif
    };
    // front
    if(front_layer.load()!=need){
      loadInto(front_buf, need);
      front_layer.store(need);
      front_ready.store(true);
      cv_engine.notify_all();
    }
    if(pre!=need && back_layer.load()!=pre){
      loadInto(back_buf, pre);
      back_layer.store(pre);
      back_ready.store(true);
    }
    std::unique_lock<std::mutex> lk(mtx);
    cv_disk.wait_for(lk, std::chrono::milliseconds(5), [&]{ return stop_signal.load() || current_layer.load()!=cur; });
  }
}
