#include "NvmeStreamer.h"
#include <stdexcept>
#include <algorithm>

#ifdef _WIN32
#include <windows.h>
#else
#include <fcntl.h>
#include <unistd.h>
#endif

namespace sovara {

NvmeStreamer::NvmeStreamer(const std::string& cacheFilePath, size_t blockSizeBytes)
    : m_cacheFilePath(cacheFilePath), m_blockSizeBytes(blockSizeBytes), m_fileHandle(nullptr), m_running(false) {
}

NvmeStreamer::~NvmeStreamer() {
    Shutdown();
}

bool NvmeStreamer::Initialize() {
#ifdef _WIN32
    HANDLE hFile = CreateFileA(
        m_cacheFilePath.c_str(),
        GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ,
        NULL,
        OPEN_ALWAYS,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_NO_BUFFERING | FILE_FLAG_OVERLAPPED, // Direct IO
        NULL
    );
    if (hFile == INVALID_HANDLE_VALUE) {
        return false;
    }
    m_fileHandle = hFile;
#else
    int fd = open(m_cacheFilePath.c_str(), O_RDWR | O_CREAT | O_DIRECT, 0644);
    if (fd < 0) return false;
    m_fileHandle = reinterpret_cast<void*>(static_cast<intptr_t>(fd));
#endif

    m_running = true;
    m_workerThread = std::thread(&NvmeStreamer::WorkerThread, this);
    return true;
}

void NvmeStreamer::Shutdown() {
    if (m_running) {
        m_running = false;
        m_queueCv.notify_all();
        if (m_workerThread.joinable()) {
            m_workerThread.join();
        }
    }

    if (m_fileHandle) {
#ifdef _WIN32
        CloseHandle(static_cast<HANDLE>(m_fileHandle));
#else
        close(static_cast<int>(reinterpret_cast<intptr_t>(m_fileHandle)));
#endif
        m_fileHandle = nullptr;
    }
}

void NvmeStreamer::PrefetchBlockAsync(uint32_t layerIndex, uint32_t blockIndex, uint64_t diskOffset, void* targetRamBuffer) {
    std::lock_guard<std::mutex> lock(m_queueMutex);
    m_requestQueue.push_back({layerIndex, blockIndex, diskOffset, m_blockSizeBytes, targetRamBuffer});
    m_queueCv.notify_one();
}

bool NvmeStreamer::WaitForBlock(uint32_t layerIndex, uint32_t blockIndex) {
    uint64_t blockId = (static_cast<uint64_t>(layerIndex) << 32) | blockIndex;
    std::unique_lock<std::mutex> lock(m_completionMutex);
    m_completionCv.wait(lock, [this, blockId]() {
        return std::find(m_completedBlocks.begin(), m_completedBlocks.end(), blockId) != m_completedBlocks.end();
    });
    return true;
}

void NvmeStreamer::WorkerThread() {
    while (m_running) {
        BlockRequest req;
        {
            std::unique_lock<std::mutex> lock(m_queueMutex);
            m_queueCv.wait(lock, [this]() { return !m_running || !m_requestQueue.empty(); });
            
            if (!m_running && m_requestQueue.empty()) break;
            
            req = m_requestQueue.front();
            m_requestQueue.erase(m_requestQueue.begin());
        }

        // Perform actual disk IO
        bool success = PerformUnbufferedRead(req.diskOffset, req.targetRamBuffer, req.sizeBytes);
        
        if (success) {
            uint64_t blockId = (static_cast<uint64_t>(req.layerIndex) << 32) | req.blockIndex;
            std::lock_guard<std::mutex> lock(m_completionMutex);
            m_completedBlocks.push_back(blockId);
            m_completionCv.notify_all();
        }
    }
}

bool NvmeStreamer::PerformUnbufferedRead(uint64_t offset, void* buffer, size_t size) {
    if (!m_fileHandle) return false;

#ifdef _WIN32
    OVERLAPPED overlapped = {0};
    overlapped.Offset = static_cast<DWORD>(offset & 0xFFFFFFFF);
    overlapped.OffsetHigh = static_cast<DWORD>(offset >> 32);
    
    DWORD bytesRead = 0;
    BOOL result = ReadFile(static_cast<HANDLE>(m_fileHandle), buffer, static_cast<DWORD>(size), &bytesRead, &overlapped);
    
    if (!result && GetLastError() == ERROR_IO_PENDING) {
        result = GetOverlappedResult(static_cast<HANDLE>(m_fileHandle), &overlapped, &bytesRead, TRUE);
    }
    return result == TRUE && bytesRead == size;
#else
    int fd = static_cast<int>(reinterpret_cast<intptr_t>(m_fileHandle));
    ssize_t bytesRead = pread(fd, buffer, size, offset);
    return bytesRead == static_cast<ssize_t>(size);
#endif
}

} // namespace sovara
