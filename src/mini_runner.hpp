// mini_runner.hpp — thin engine-facing wrapper around DiskKVCacheManager.
//
// Owns the per-model KV-cache file lifecycle at the app-data location:
//   <cacheDir>/kv_<model file name>.bin
// Block size defaults to 256KB — large enough to amortize NVMe read latency,
// small enough that 32 double-buffered layers fit in ~16MB of system RAM.
#pragma once

#include "disk_kv_cache.hpp"

#include <cstddef>
#include <memory>
#include <string>

struct MiniRunner {
  MiniRunner(std::string cacheDir, std::size_t blockKb = 256);

  // Creates <cacheDir>/kv_<model>.bin sized layerCount * blockSize and wires
  // the DiskKVCacheManager. Returns false (never throws) when the disk cache
  // cannot be provisioned — callers must fall back to RAM-only execution.
  bool init(const std::string& modelPath, std::size_t layerCount = 32);

  // Engine-facing accessors forwarded to the cache manager.
  char* GetLayerKV(std::size_t layerId);
  void  ReleaseLayer(std::size_t layerId);
  bool  ready() const noexcept { return static_cast<bool>(kv_); }

  // Telemetry passthrough (UI state matrix).
  double      disk_read_mbps() const;
  std::size_t prefetched_layer() const;
  std::size_t block_bytes() const noexcept { return blockSize_; }

  std::string cacheDir_;
  std::size_t blockSize_ = 256 * 1024;
  std::unique_ptr<DiskKVCacheManager> kv_;
};
