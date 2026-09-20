// mini_runner.cpp — MiniRunner implementation.
//
// Provisions the per-model KV file at the app-data location and owns the
// DiskKVCacheManager lifetime. All failures are non-throwing by design:
// the Electron layer degrades to RAM-only execution when init() is false.

#include "mini_runner.hpp"

#include <cstdio>
#include <filesystem>
#include <stdexcept>

MiniRunner::MiniRunner(std::string cacheDir, size_t blockKb)
  : cacheDir_(std::move(cacheDir)), blockSize_(blockKb * 1024) {
  if (blockSize_ < 4096) blockSize_ = 4096;
  // Round to a 4096 multiple — Direct I/O contract.
  blockSize_ = ((blockSize_ + 4095) / 4096) * 4096;
}

bool MiniRunner::init(const std::string& modelPath, size_t layerCount) {
  try {
    std::filesystem::create_directories(cacheDir_);
    const std::string stem = std::filesystem::path(modelPath).filename().string();
    if (stem.empty()) return false;
    const std::string kvPath = cacheDir_ + std::string(1, std::filesystem::path::preferred_separator) +
                               "kv_" + stem + ".bin";

    // Provision (or reuse) the KV file: layerCount blocks of blockSize each.
    const std::uintmax_t want = static_cast<std::uintmax_t>(layerCount) * blockSize_;
    std::error_code ec;
    if (!std::filesystem::exists(kvPath) || std::filesystem::file_size(kvPath, ec) != want || ec) {
      FILE* f = nullptr;
#ifdef _WIN32
      fopen_s(&f, kvPath.c_str(), "wb");
#else
      f = std::fopen(kvPath.c_str(), "wb");
#endif
      if (f == nullptr) return false;
      // Seek-sparse write: extend to `want` bytes without touching every page.
      if (std::fseek(f, static_cast<long>(want - 1), SEEK_SET) != 0) { std::fclose(f); return false; }
      const char zero = 0;
      if (std::fwrite(&zero, 1, 1, f) != 1) { std::fclose(f); return false; }
      std::fclose(f);
    }

    kv_ = std::make_unique<DiskKVCacheManager>(kvPath, blockSize_, layerCount);
    return true;
  } catch (...) {
    kv_.reset();
    return false;
  }
}

char* MiniRunner::GetLayerKV(size_t layerId) {
  if (!kv_) return nullptr;
  return kv_->GetLayerKV(layerId);
}

void MiniRunner::ReleaseLayer(size_t layerId) {
  if (kv_) kv_->ReleaseLayer(layerId);
}

double MiniRunner::disk_read_mbps() const {
  return kv_ ? kv_->disk_read_mbps() : 0.0;
}

size_t MiniRunner::prefetched_layer() const {
  return kv_ ? kv_->prefetched_layer() : static_cast<size_t>(-1);
}
