<div align="center">
  <h1>🌌 SOVARA: Autonomous Local-First Agent</h1>
  <p>A sovereign, privacy-first AI coding companion optimized for consumer hardware.</p>
  
  [![Download .exe](https://img.shields.io/badge/Download-Windows_.exe-0078D6?style=for-the-badge&logo=windows)](https://github.com/karthik-ak-Git/SOVARA/releases/tag/Sovara-versions)
  
  ![NPM Version](https://img.shields.io/npm/v/sovara?color=blue&label=npx%20sovara)
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
| 📦 **Frictionless Setup** | 1-line PowerShell or NPX installation. |
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
├── 📁 packages
│   └── 📁 sovara       # NPX 1-line installer package
└── 📁 docs             # Architecture and phase documentation
```

## 🚀 How to Use

### True Local Execution (Windows Only)
Unlocks the full autonomous experience with local file editing and hardware-optimized AI models.

**Method A: Direct Download (Easiest)**
👉 **[Download the .exe from our Release Page](https://github.com/karthik-ak-Git/SOVARA/releases/tag/Sovara-versions)**

**Method B: 1-Line PowerShell Install**
Open PowerShell and run:
```powershell
iwr -useb https://raw.githubusercontent.com/karthik-ak-Git/SOVARA/main/install.ps1 | iex
```

**Method C: Node.js / NPM Install**
If you have Node.js installed, simply run:
```bash
npx --yes sovara@latest
```

*(Both methods will automatically fetch the latest optimized `.exe` from GitHub and launch the installer).*

## 🧠 How Hardware Optimization Works

| Hardware Detected | Model Quantization | Status |
| :--- | :--- | :--- |
| **> 8GB VRAM (NVIDIA)** | 8-bit (Q8_0) | 🟢 Maximum Quality |
| **< 8GB VRAM / CPU** | 4-bit (Q4_K_M) | 🟡 Optimized for Speed |
| **Apple Silicon (Mac)** | Metal Accelerated | *(Coming Soon)* |

## 👨‍💻 Author

**Karthik AK**
- 🐙 GitHub: [@karthik-ak-Git](https://github.com/karthik-ak-Git)

> 🌟 **Star this repo** if you find it useful!
