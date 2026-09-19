{
  "targets": [{
    "target_name": "disk_llama_core",
    "sources": ["src/disk_kv_cache.cpp", "src/addon_binding.cpp"],
    "include_dirs": ["<!(node -p \"require('node-addon-api').include\")"],
    "defines": ["NAPI_VERSION=8"],
    "cflags_cc": ["-std=c++17", "-O3", "-flto", "-fexceptions"],
    "cflags": ["-O3", "-flto"],
    "xcode_settings": {
      "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
      "GCC_OPTIMIZATION_LEVEL": "3",
      "LLVM_LTO": "YES"
    },
    "msvs_settings": {
      "VCCLCompilerTool": {
        "AdditionalOptions": ["/std:c++17", "/O2", "/GL", "/EHsc"],
        "ExceptionHandling": 1
      },
      "VCLinkerTool": { "LinkTimeCodeGeneration": 1 }
    },
    "conditions": [
      ["OS=='win'", { "libraries": [] }],
      ["OS=='linux'", { "libraries": ["-lrt"] }]
    ]
  }]
}
