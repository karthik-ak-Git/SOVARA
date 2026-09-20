#pragma once

#include <string>
#include <vector>
#include <thread>
#include <atomic>
#include <mutex>
#include <condition_variable>

namespace sovara {

struct BlockRequest {
    uint32_t layerIndex;
    uint32_t blockIndex;
    uint64_t diskOffset;
    size_t sizeBytes;
    void* targetRamBuffer;
};

class NvmeStreamer {
public:
    NvmeStreamer(const std::string& cacheFilePath, size_t blockSizeBytes);
    ~NvmeStreamer();

    bool Initialize();
    void Shutdown();

    // Enqueue a request to stream a block from NVMe to RAM
    void PrefetchBlockAsync(uint32_t layerIndex, uint32_t blockIndex, uint64_t diskOffset, void* targetRamBuffer);
    
    // Wait for a specific block to be fully loaded into RAM
    bool WaitForBlock(uint32_t layerIndex, uint32_t blockIndex);

private:
    void WorkerThread();
    bool PerformUnbufferedRead(uint64_t offset, void* buffer, size_t size);

    std::string m_cacheFilePath;
    size_t m_blockSizeBytes;
    
    // OS-specific file handle (void* to avoid leaking windows.h everywhere)
    void* m_fileHandle;

    std::atomic<bool> m_running;
    std::thread m_workerThread;
    
    std::mutex m_queueMutex;
    std::condition_variable m_queueCv;
    std::vector<BlockRequest> m_requestQueue;

    // Track completed blocks for synchronization
    std::mutex m_completionMutex;
    std::condition_variable m_completionCv;
    // Map of (layerIndex << 32 | blockIndex) -> bool
    std::vector<uint64_t> m_completedBlocks;
};

} // namespace sovara
