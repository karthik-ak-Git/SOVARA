#include "CacheEngine.h"
#include <cstdlib>
#include <iostream>

#ifdef _WIN32
#include <malloc.h>
#else
#include <stdlib.h>
#endif

namespace sovara {

CacheEngine::CacheEngine(size_t totalRamBudgetBytes, size_t totalVramBudgetBytes, const std::string& cachePath)
    : m_ramBudget(totalRamBudgetBytes), m_vramBudget(totalVramBudgetBytes), m_cachePath(cachePath) {
    // Arbitrary size for 1M token block sizes (e.g. 256MB per layer block)
    m_blockSize = 256 * 1024 * 1024; 
}

CacheEngine::~CacheEngine() {
    m_streamer.reset();
    FreeBuffers();
}

bool CacheEngine::Initialize() {
    m_streamer = std::make_unique<NvmeStreamer>(m_cachePath, m_blockSize);
    if (!m_streamer->Initialize()) {
        return false;
    }
    
    AllocateBuffers();
    return true;
}

void CacheEngine::AllocateBuffers() {
    size_t numBuffers = m_ramBudget / m_blockSize;
    if (numBuffers < 2) numBuffers = 2; // Require at least double buffering

    for (size_t i = 0; i < numBuffers; ++i) {
        void* ptr = nullptr;
#ifdef _WIN32
        ptr = _aligned_malloc(m_blockSize, 4096); // 4K aligned for O_DIRECT
#else
        posix_memalign(&ptr, 4096, m_blockSize);
#endif
        if (ptr) {
            m_ramBuffers.push_back(ptr);
        }
    }
    m_layerToBufferMap.resize(100, -1); // Assuming 100 layers max for now
}

void CacheEngine::FreeBuffers() {
    for (void* ptr : m_ramBuffers) {
#ifdef _WIN32
        _aligned_free(ptr);
#else
        free(ptr);
#endif
    }
    m_ramBuffers.clear();
}

void CacheEngine::BeginToken(uint32_t tokenId) {
    // Initiate prefetch for the first few layers
    // In a real implementation, we would prefetch ahead of the compute
    if (m_ramBuffers.size() >= 2) {
        m_streamer->PrefetchBlockAsync(0, 0, 0, m_ramBuffers[0]);
        m_layerToBufferMap[0] = 0;
        
        m_streamer->PrefetchBlockAsync(1, 0, m_blockSize, m_ramBuffers[1]);
        m_layerToBufferMap[1] = 1;
    }
}

void* CacheEngine::GetLayerKvCache(uint32_t layerIndex) {
    // Wait for streamer to finish loading this layer
    m_streamer->WaitForBlock(layerIndex, 0);
    
    int bufferIdx = m_layerToBufferMap[layerIndex];
    if (bufferIdx >= 0 && bufferIdx < static_cast<int>(m_ramBuffers.size())) {
        return m_ramBuffers[bufferIdx];
    }
    return nullptr;
}

void CacheEngine::FinishLayer(uint32_t layerIndex) {
    // Free up this layer's buffer and prefetch the layer ahead (layerIndex + 2)
    int bufferIdx = m_layerToBufferMap[layerIndex];
    if (bufferIdx >= 0) {
        uint32_t nextLayer = layerIndex + 2;
        if (nextLayer < m_layerToBufferMap.size()) {
            uint64_t diskOffset = static_cast<uint64_t>(nextLayer) * m_blockSize;
            m_streamer->PrefetchBlockAsync(nextLayer, 0, diskOffset, m_ramBuffers[bufferIdx]);
            m_layerToBufferMap[nextLayer] = bufferIdx;
        }
        m_layerToBufferMap[layerIndex] = -1;
    }
}

} // namespace sovara
