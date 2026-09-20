#include <napi.h>
#include "CacheEngine.h"

using namespace sovara;

class CacheEngineWrapper : public Napi::ObjectWrap<CacheEngineWrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "CacheEngine", {
            InstanceMethod("initialize", &CacheEngineWrapper::Initialize),
            InstanceMethod("beginToken", &CacheEngineWrapper::BeginToken),
            InstanceMethod("finishLayer", &CacheEngineWrapper::FinishLayer)
        });

        Napi::FunctionReference* constructor = new Napi::FunctionReference();
        *constructor = Napi::Persistent(func);
        env.SetInstanceData(constructor);

        exports.Set("CacheEngine", func);
        return exports;
    }

    CacheEngineWrapper(const Napi::CallbackInfo& info) : Napi::ObjectWrap<CacheEngineWrapper>(info) {
        Napi::Env env = info.Env();
        
        if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsString()) {
            Napi::TypeError::New(env, "Expected (ramBudget, vramBudget, cachePath)").ThrowAsJavaScriptException();
            return;
        }
        
        size_t ramBudget = info[0].As<Napi::Number>().Int64Value();
        size_t vramBudget = info[1].As<Napi::Number>().Int64Value();
        std::string cachePath = info[2].As<Napi::String>().Utf8Value();
        
        m_engine = std::make_unique<CacheEngine>(ramBudget, vramBudget, cachePath);
    }

private:
    Napi::Value Initialize(const Napi::CallbackInfo& info) {
        bool success = m_engine->Initialize();
        return Napi::Boolean::New(info.Env(), success);
    }

    Napi::Value BeginToken(const Napi::CallbackInfo& info) {
        if (info.Length() > 0 && info[0].IsNumber()) {
            uint32_t tokenId = info[0].As<Napi::Number>().Uint32Value();
            m_engine->BeginToken(tokenId);
        }
        return info.Env().Undefined();
    }
    
    Napi::Value FinishLayer(const Napi::CallbackInfo& info) {
        if (info.Length() > 0 && info[0].IsNumber()) {
            uint32_t layerIndex = info[0].As<Napi::Number>().Uint32Value();
            m_engine->FinishLayer(layerIndex);
        }
        return info.Env().Undefined();
    }

    std::unique_ptr<CacheEngine> m_engine;
};

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    return CacheEngineWrapper::Init(env, exports);
}

NODE_API_MODULE(cache_engine, InitAll)
