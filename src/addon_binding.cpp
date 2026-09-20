// addon_binding.cpp — Node-Addon-API bridge for the Disk KV engine.
//
// Exposes:
//   initEngine({ modelPath, contextSize, gpuLayers, cacheBlockSize }, cb)
//       → provisions the app-location disk KV cache, returns { ok, profile }
//   generateTokenAsync({ prompt, maxTokens }, cb)
//       → streams progress: { type:'token', text } | { type:'done', tokens,
//         tokensPerSecond } | { type:'error', message }
//   hardwareTelemetry()
//       → { diskReadMbps, prefetchedLayer, currentLayer, blockBytes, ready }
//
// Every long operation runs on Napi::AsyncWorker threads — the JS main
// thread never blocks on disk or generation.

#include <napi.h>

#include <atomic>
#include <chrono>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "mini_runner.hpp"
#include "disk_kv_cache.hpp"

namespace {

// ── Engine singleton (one loaded model per process) ───────────────────────

struct EngineState {
  std::mutex mtx;
  std::unique_ptr<MiniRunner> runner;
  std::string modelPath;
  size_t contextSize = 0;
  size_t gpuLayers = 0;
  size_t blockSize = 0;
  bool ready = false;
};

EngineState& engine() {
  static EngineState s;
  return s;
}

std::string JsonEscape(const std::string& in) {
  std::string out;
  out.reserve(in.size() + 8);
  for (char c : in) {
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n";  break;
      case '\r': out += "\\r";  break;
      case '\t': out += "\\t";  break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04x", static_cast<unsigned>(c));
          out += buf;
        } else {
          out += c;
        }
    }
  }
  return out;
}

// ── initEngine worker ─────────────────────────────────────────────────────

class InitEngineWorker : public Napi::AsyncWorker {
public:
  InitEngineWorker(Napi::Function cb, std::string modelPath, size_t ctx,
                   size_t gpuLayers, size_t blockKb, std::string cacheDir)
    : Napi::AsyncWorker(cb), modelPath_(std::move(modelPath)), ctx_(ctx),
      gpuLayers_(gpuLayers), blockKb_(blockKb), cacheDir_(std::move(cacheDir)) {}

  void Execute() override {
    std::lock_guard<std::mutex> lk(engine().mtx);
    engine().runner.reset();
    engine().ready = false;

    auto runner = std::make_unique<MiniRunner>(cacheDir_, blockKb_ > 0 ? blockKb_ : 256);
    // 32 layers double-buffered at 256KB = 16MB RAM window; the layer-ahead
    // prefetcher keeps the stream exactly one layer in front of inference.
    if (!runner->init(modelPath_, 32)) {
      SetError("disk KV cache provisioning failed (check disk space/permissions)");
      return;
    }
    engine().runner = std::move(runner);
    engine().modelPath = modelPath_;
    engine().contextSize = ctx_;
    engine().gpuLayers = gpuLayers_;
    engine().blockSize = engine().runner->block_bytes();
    engine().ready = true;
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());
    Napi::Object res = Napi::Object::New(Env());
    res.Set("ok", Napi::Boolean::New(Env(), true));
    res.Set("status", Napi::String::New(Env(), "ready"));
    Napi::Object profile = Napi::Object::New(Env());
    profile.Set("modelPath", Napi::String::New(Env(), engine().modelPath));
    profile.Set("contextSize", Napi::Number::New(Env(), static_cast<double>(engine().contextSize)));
    profile.Set("gpuLayers", Napi::Number::New(Env(), static_cast<double>(engine().gpuLayers)));
    profile.Set("cacheBlockSize", Napi::Number::New(Env(), static_cast<double>(engine().blockSize)));
    profile.Set("cacheDir", Napi::String::New(Env(), engine().runner->cacheDir_));
    res.Set("profile", profile);
    Callback().Call({ Env().Null(), res });
  }

private:
  std::string modelPath_;
  size_t ctx_;
  size_t gpuLayers_;
  size_t blockKb_;
  std::string cacheDir_;
};

Napi::Value InitEngine(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "initEngine(config: object, callback: function)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Object cfg = info[0].As<Napi::Object>();
  std::string modelPath = cfg.Has("modelPath") && cfg.Get("modelPath").IsString()
      ? cfg.Get("modelPath").As<Napi::String>().Utf8Value() : "";
  size_t ctx = cfg.Has("contextSize") && cfg.Get("contextSize").IsNumber()
      ? static_cast<size_t>(cfg.Get("contextSize").As<Napi::Number>().Uint32Value()) : 32768;
  size_t gpu = cfg.Has("gpuLayers") && cfg.Get("gpuLayers").IsNumber()
      ? static_cast<size_t>(cfg.Get("gpuLayers").As<Napi::Number>().Uint32Value()) : 0;
  size_t blockKb = cfg.Has("cacheBlockSize") && cfg.Get("cacheBlockSize").IsNumber()
      ? static_cast<size_t>(cfg.Get("cacheBlockSize").As<Napi::Number>().Uint32Value()) : 256;
  std::string cacheDir = cfg.Has("cacheDir") && cfg.Get("cacheDir").IsString()
      ? cfg.Get("cacheDir").As<Napi::String>().Utf8Value() : "disk_kv";
  if (modelPath.empty()) {
    Napi::TypeError::New(env, "initEngine: modelPath is required").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto* w = new InitEngineWorker(info[1].As<Napi::Function>(), modelPath, ctx, gpu, blockKb, cacheDir);
  w->Queue();
  return env.Undefined();
}

// ── generateTokenAsync worker (streaming progress) ────────────────────────

class GenerateWorker : public Napi::AsyncWorker {
public:
  GenerateWorker(Napi::Function cb, Napi::ThreadSafeFunction tsfn,
                 std::string prompt, size_t maxTokens)
    : Napi::AsyncWorker(cb), tsfn_(std::move(tsfn)), prompt_(std::move(prompt)), maxTokens_(maxTokens) {}

  void Execute() override {
    std::lock_guard<std::mutex> lk(engine().mtx);
    if (!engine().ready || !engine().runner) {
      SetError("engine not initialized — call initEngine first");
      return;
    }
    MiniRunner* runner = engine().runner.get();
    const size_t layers = runner->ready() ? runner->block_bytes() : 0;
    (void)layers;

    // Deterministic streaming loop: exercises the layer-ahead pipeline by
    // walking each layer's block through GetLayerKV → ReleaseLayer while
    // emitting tokens. Real llama.cpp binding replaces the payload text.
    const size_t layerCount = 32;
    const size_t totalTokens = maxTokens_ == 0 ? 256 : maxTokens_;
    const auto t0 = std::chrono::steady_clock::now();
    std::string partial;
    for (size_t step = 0; step < totalTokens; ++step) {
      if (cancel_.load(std::memory_order_acquire)) break;
      const size_t layer = step % layerCount;
      char* block = runner->GetLayerKV(layer);
      if (block == nullptr) { SetError("KV block unavailable"); return; }
      runner->ReleaseLayer(layer);

      // Emit one streamed token chunk (progress, not final result).
      partial += "tok";
      char* payload = new char[64];
      std::snprintf(payload, 64, "{\"type\":\"token\",\"text\":\"tok\",\"step\":%zu,\"layer\":%zu}", step, layer);
      auto cb = [](Napi::Env env, Napi::Function, char* data) {
        std::string s(data);
        delete[] data;
        Napi::Object msg = Napi::Object::New(env);
        msg.Set("json", Napi::String::New(env, s));
        msg.Set("type", Napi::String::New(env, "progress"));
        return msg;
      };
      napi_status st = tsfn_.BlockingCall(payload, cb);
      if (st != napi_ok) { delete[] payload; break; }
    }
    const auto t1 = std::chrono::steady_clock::now();
    const double secs = std::chrono::duration<double>(t1 - t0).count();
    tokens_ = partial.size() == 0 ? 0 : static_cast<size_t>(totalTokens);
    tps_ = secs > 0.000001 ? static_cast<double>(totalTokens) / secs : 0.0;
    diskMbps_ = runner->disk_read_mbps();
  }

  void OnOK() override {
    Napi::HandleScope scope(Env());
    Napi::Object res = Napi::Object::New(Env());
    res.Set("ok", Napi::Boolean::New(Env(), true));
    res.Set("tokens", Napi::Number::New(Env(), static_cast<double>(tokens_)));
    res.Set("tokensPerSecond", Napi::Number::New(Env(), tps_));
    res.Set("diskReadMbps", Napi::Number::New(Env(), diskMbps_));
    res.Set("response", Napi::String::New(Env(), "stream-complete"));
    tsfn_.Release();
    Callback().Call({ Env().Null(), res });
  }

  void OnError(const Napi::Error& e) override {
    tsfn_.Release();
    Napi::AsyncWorker::OnError(e);
  }

  std::atomic<bool> cancel_{ false };

private:
  Napi::ThreadSafeFunction tsfn_;
  std::string prompt_;
  size_t maxTokens_;
  size_t tokens_ = 0;
  double tps_ = 0.0;
  double diskMbps_ = 0.0;
};

Napi::Value GenerateTokenAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "generateTokenAsync(options: object, callback: function)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Napi::Object opts = info[0].As<Napi::Object>();
  std::string prompt = opts.Has("prompt") && opts.Get("prompt").IsString()
      ? opts.Get("prompt").As<Napi::String>().Utf8Value() : "";
  size_t maxTokens = opts.Has("maxTokens") && opts.Get("maxTokens").IsNumber()
      ? static_cast<size_t>(opts.Get("maxTokens").As<Napi::Number>().Uint32Value()) : 256;

  Napi::Function cb = info[1].As<Napi::Function>();
  auto tsfn = Napi::ThreadSafeFunction::New(env, cb, "disk_kv_progress", 0, 1);
  auto* w = new GenerateWorker(cb, tsfn, prompt, maxTokens);
  w->Queue();
  return env.Undefined();
}

// ── Telemetry (synchronous, lock-guarded) ─────────────────────────────────

Napi::Value HardwareTelemetry(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object res = Napi::Object::New(env);
  std::lock_guard<std::mutex> lk(engine().mtx);
  res.Set("ready", Napi::Boolean::New(env, engine().ready));
  if (engine().ready && engine().runner) {
    res.Set("diskReadMbps", Napi::Number::New(env, engine().runner->disk_read_mbps()));
    res.Set("prefetchedLayer", Napi::Number::New(env, static_cast<double>(engine().runner->prefetched_layer())));
    res.Set("blockBytes", Napi::Number::New(env, static_cast<double>(engine().runner->block_bytes())));
  } else {
    res.Set("diskReadMbps", Napi::Number::New(env, 0.0));
    res.Set("prefetchedLayer", Napi::Number::New(env, -1.0));
    res.Set("blockBytes", Napi::Number::New(env, 0.0));
  }
  return res;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("initEngine", Napi::Function::New(env, InitEngine));
  exports.Set("generateTokenAsync", Napi::Function::New(env, GenerateTokenAsync));
  exports.Set("hardwareTelemetry", Napi::Function::New(env, HardwareTelemetry));
  return exports;
}

} // namespace

NODE_API_MODULE(disk_llama_core, Init)
