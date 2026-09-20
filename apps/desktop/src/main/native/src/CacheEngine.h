#pragma once

#include "NvmeStreamer.h"
#include <memory>
#include <vector>

namespace sovara {

class CacheEngine {
public:
    CacheEngine(size_t totalRamBudgetBytes, size_t totalVramBudgetBytes, const std::string& cachePath);
    ~CacheEngine();

    bool Initialize();

    // Start a forward pass for a specific token
    void BeginToken(uint32_t tokenId);

    // Get a pointer to the KV block for a specific layer. 
    // This will block if the prefetcher hasn't finished loading it into RAM yet.
    void* GetLayerKvCache(uint32_t layerIndex);

    // Mark layer as completed so the buffer can be recycled
    void FinishLayer(uint32_t layerIndex);

private:
    size_t m_ramBudget;
    size_t m_vramBudget;
    size_t m_blockSize;
    std::string m_cachePath;

    std::unique_ptr<NvmeStreamer> m_streamer;
    
    // Double buffered RAM pointers
    std::vector<void*> m_ramBuffers;
    
    // Track which buffer holds which layer currently
    std::vector<int32_t> m_layerToBufferMap;

    void AllocateBuffers();
    void FreeBuffers();
};

} // namespace sovara
