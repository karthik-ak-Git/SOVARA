#include "mini_runner.hpp"
#include <filesystem>
MiniRunner::MiniRunner(std::string c, size_t kb): cacheDir(std::move(c)), blockSize(kb*1024) {}
bool MiniRunner::init(std::string modelPath){
  std::filesystem::create_directories(cacheDir);
  std::string kvPath = cacheDir + "/kv_" + std::filesystem::path(modelPath).filename().string() + ".bin";
  // consumer hardware: 256KB block, 32 layers, app location only, no OS cache
  try { kv = std::make_unique<DiskKVCacheManager>(kvPath, blockSize, 32); return true; } catch(...) { return false; }
}
