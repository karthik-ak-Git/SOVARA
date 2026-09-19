#include <napi.h>
#include "disk_kv_cache.hpp"
#include <string>
#include <memory>
#include <thread>

class LlamaContextWorker : public Napi::AsyncWorker {
public:
  LlamaContextWorker(Napi::Function cb, std::string modelPath, size_t ctx, size_t gpuLayers, size_t blockSize)
  : Napi::AsyncWorker(cb), modelPath(std::move(modelPath)), contextSize(ctx), gpuLayers(gpuLayers), cacheBlockSize(blockSize) {}
  void Execute() override {
    // init disk cache at app location
    std::string cachePath = modelPath + ".kv_cache";
    try {
      cache = std::make_unique<DiskKVCacheManager>(cachePath, cacheBlockSize, 32);
    } catch(...) {}
  }
  void OnOK() override {
    Napi::HandleScope scope(Env());
    Callback().Call({ Env().Null(), Napi::String::New(Env(), "ready") });
  }
private:
  std::string modelPath; size_t contextSize; size_t gpuLayers; size_t cacheBlockSize;
  std::unique_ptr<DiskKVCacheManager> cache;
};

Napi::Value InitEngine(const Napi::CallbackInfo& info){
  Napi::Env env = info.Env();
  Napi::Object cfg = info[0].As<Napi::Object>();
  std::string modelPath = cfg.Get("modelPath").As<Napi::String>().Utf8Value();
  size_t ctx = cfg.Get("contextSize").As<Napi::Number>().Uint32Value();
  size_t gpu = cfg.Has("gpuLayers") ? cfg.Get("gpuLayers").As<Napi::Number>().Uint32Value() : 0;
  size_t block = cfg.Has("cacheBlockSize") ? cfg.Get("cacheBlockSize").As<Napi::Number>().Uint32Value() : 4096*1024;
  Napi::Function cb = info[1].As<Napi::Function>();
  auto* w = new LlamaContextWorker(cb, modelPath, ctx, gpu, block);
  w->Queue();
  return env.Undefined();
}

Napi::Value GenerateTokenAsync(const Napi::CallbackInfo& info){
  Napi::Env env = info.Env();
  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports){
  exports.Set("initEngine", Napi::Function::New(env, InitEngine));
  exports.Set("generateTokenAsync", Napi::Function::New(env, GenerateTokenAsync));
  return exports;
}
NODE_API_MODULE(disk_llama_core, Init)
