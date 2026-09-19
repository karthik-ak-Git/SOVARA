#pragma once
#include "disk_kv_cache.hpp"
#include <string>
struct MiniRunner {
  MiniRunner(std::string cacheDir, size_t blockKb=256);
  bool init(std::string modelPath);
  std::string cacheDir;
  size_t blockSize;
  std::unique_ptr<DiskKVCacheManager> kv;
};
