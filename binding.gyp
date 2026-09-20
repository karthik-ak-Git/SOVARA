{
  "targets": [
    {
      "target_name": "disk_llama_core",
      "sources": [
        "src/disk_kv_cache.cpp",
        "src/mini_runner.cpp",
        "src/addon_binding.cpp"
      ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include.replace(/\\\"/g,'')\")"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NAPI_CPP_EXCEPTIONS"
      ],
      "cflags": ["-O3", "-flto"],
      "cflags_cc": ["-std=c++17", "-O3", "-flto", "-fexceptions"],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "CLANG_CXX_LIBRARY": "libc++",
        "GCC_OPTIMIZATION_LEVEL": "3",
        "LLVM_LTO": "YES",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "MACOSX_DEPLOYMENT_TARGET": "10.15"
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/std:c++17", "/O2", "/GL", "/EHsc", "/Zi"],
          "ExceptionHandling": 1,
          "WholeProgramOptimization": "true",
          "RuntimeLibrary": 0
        },
        "VCLibrarianTool": { "AdditionalOptions": ["/LTCG"] },
        "VCLinkerTool": {
          "LinkTimeCodeGeneration": 1,
          "OptimizeReferences": 2,
          "EnableCOMDATFolding": 2
        }
      },
      "conditions": [
        ["OS=='win'", {
          "defines": ["WIN32_LEAN_AND_MEAN", "NOMINMAX", "_CRT_SECURE_NO_WARNINGS"],
          "msvs_settings": {
            "VCCLCompilerTool": { "ExceptionHandling": 1 }
          }
        }],
        ["OS=='linux'", {
          "cflags_cc": ["-pthread"],
          "libraries": ["-lpthread", "-lrt"],
          "defines": ["_FILE_OFFSET_BITS=64"]
        }],
        ["OS=='mac'", {
          "xcode_settings": { "OTHER_CPLUSPLUSFLAGS": ["-std=c++17", "-O3", "-fexceptions"] }
        }]
      ]
    }
  ]
}
