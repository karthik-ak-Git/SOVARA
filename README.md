<div align="center">
  <h1><img src="apps/desktop/src/renderer/public/logo.png" alt="Sovara logo" width="72" style="vertical-align: middle;" /> SOVARA: Autonomous Local-First Agent</h1>
  <p>A sovereign, privacy-first AI coding companion optimized for consumer hardware.</p>
  
  [![Download .exe](https://img.shields.io/badge/Download-Windows_.exe-0078D6?style=for-the-badge&logo=windows)](https://github.com/karthik-ak-Git/SOVARA/releases/tag/Sovara-versions)
  
  [![GitHub Package](https://img.shields.io/badge/GitHub%20Package-Published-24292f?style=for-the-badge&logo=github)](https://github.com/karthik-ak-Git/SOVARA/pkgs/npm/%40karthik-ak-git%2Fsovara)
  ![License](https://img.shields.io/badge/License-MIT-green.svg)
  ![Tech](https://img.shields.io/badge/Tech-Electron%20|%20React%20|%20TypeScript-black)
</div>

<hr />

## Desktop-only release

SOVARA ships as a Windows desktop application. The browser sandbox has been removed; local filesystem access, model runtimes, and tool execution are available only inside the Electron desktop app.

## 📌 About

SOVARA is an on-premise, offline-first AI workbench designed for confidential industrial work and agentic coding. It gives you a powerful LLM assistant that can read, write, and execute code directly on your local filesystem—without sending your intellectual property to the cloud.

This platform is built to demonstrate:
- **100% Privacy:** No telemetry and no cloud dependency for the desktop app.
- **Agentic Capabilities:** Edits files, runs shell commands, and manages workspaces.
- **Hardware Agnosticism:** Dynamically optimizes local models based on your specific RAM/VRAM availability.

## ✨ Features

| Feature | Description |
| :--- | :--- |
| 💻 **True Local Execution** | Runs completely offline on your own hardware via Electron & Llama.cpp. |
| ⚡ **Hardware Optimization** | Auto-detects your GPU/CPU to dynamically load 4-bit (CPU) or 8-bit (GPU) models. |
| 🛡️ **Sovereign Runtime** | Local model discovery, execution permissions, and workspace tools stay inside the desktop boundary. |
| 🛠️ **Agentic Tools** | Full read/write filesystem access and terminal execution. |
| 📦 **Frictionless Setup** | Download the Windows installer or install through the GitHub Package CLI. |
| 🎨 **Modern UI** | A coherent light desktop interface with session management and local tool surfaces. |

## 🛠️ Tech Stack

| Technology | Role |
| :--- | :--- |
| **Electron** | Desktop shell and local filesystem/OS bridge |
| **React + TypeScript** | Desktop renderer UI and interaction layer |
| **Node.js** | Local backend operations and hardware probing |
| **SQLite** | Durable session and conversation storage |
| **Llama.cpp** | Local model inference and execution engine |

## 📂 Project Structure

```text
📁 SOVARA
├── 📁 apps
│   └── 📁 desktop      # Full local Electron app (True Autonomous Mode)
├── 📁 landingpage      # Public website and release download page
├── 📁 packages
│   └── 📁 sovara       # GitHub Packages installer CLI
└── 📁 docs             # Architecture and phase documentation
```

## 🚀 How to Use

### True Local Execution (Windows x64)

Sovara is a desktop-only application. The installer packages the Electron app, the ConPTY terminal resources, and the pinned llama.cpp CUDA runtime. The app does not require Python, LM Studio, Ollama, or a separate Node.js runtime after installation.

**Method A: Direct Download (Easiest)**

👉 **[Download the .exe from our Release Page](https://github.com/karthik-ak-Git/SOVARA/releases/tag/Sovara-versions)**

**Method B: GitHub Packages Installer**

The installer CLI is published as [`@karthik-ak-git/sovara`](https://github.com/karthik-ak-Git/SOVARA/pkgs/npm/%40karthik-ak-git%2Fsovara). If Node.js is installed on your Windows x64 machine, authenticate to GitHub Packages with a token that can read packages, then run:

```powershell
$env:NODE_AUTH_TOKEN = "<GitHub PAT with read:packages>"
npx --yes --package=@karthik-ak-git/sovara@latest sovara
```

The command downloads the latest Sovara Windows installer, verifies its SHA-256 digest when GitHub provides one, and launches setup. Node.js is required only for this installation method; it is not required by the installed desktop application.

The package lives in [`packages/sovara`](https://github.com/karthik-ak-Git/SOVARA/tree/main/packages/sovara) and is published automatically by the GitHub Packages workflow when a `package-v*` tag is pushed.

**Method C: PowerShell Install**

```powershell
iwr -useb https://raw.githubusercontent.com/karthik-ak-Git/SOVARA/main/install.ps1 | iex
```

## Automatic updates

Sovara checks the configured stable or beta GitHub release at startup and every six hours when **Automatic Updates** is enabled. It downloads the verified Windows installer in the background and exposes **Restart & Install** in Settings → General when the update is ready.

A local build is not available to existing installations until the installer, blockmap, and `latest.yml` are uploaded to the same `Sovara-versions` GitHub release. Stable releases use `latest.yml`; beta releases use `latest-beta.yml` and can be built with `pnpm build:win:beta`. Windows code signing is still required for a warning-free SmartScreen experience.

## 🧠 How Hardware Optimization Works

Sovara detects the GPU independently of the CPU vendor. An AMD Ryzen CPU with an NVIDIA GPU uses the bundled CUDA runtime.

| Hardware detected | Runtime decision |
| :--- | :--- |
| **NVIDIA GPU detected** | CUDA `llama-server`; full offload when the model fits |
| **NVIDIA GPU, model larger than VRAM** | Partial CUDA offload when useful, otherwise CPU/RAM |
| **AMD/Intel GPU** | CPU/RAM until a matching Vulkan or ROCm runtime is packaged |
| **No supported GPU** | CPU/RAM mode |
| **Server-sized NVIDIA GPU** | CUDA with the measured VRAM budget |

The application reports the actual placement after model load. GPU presence alone is never treated as proof of GPU acceleration.

## 👨‍💻 Author

**Karthik AK**
- 🐙 GitHub: [@karthik-ak-Git](https://github.com/karthik-ak-Git)

> 🌟 **Star this repo** if you find it useful!
