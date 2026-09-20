<div align="center">
  <h1>🌌 SOVARA: Autonomous Local-First Agent</h1>
  <p>A sovereign, privacy-first AI coding companion optimized for consumer hardware.</p>
  
  [![Download .exe](https://img.shields.io/badge/Download-Windows_.exe-0078D6?style=for-the-badge&logo=windows)](https://github.com/karthik-ak-Git/SOVARA/releases/tag/Sovara-versions)
  
  ![NPM Version](https://img.shields.io/npm/v/sovara?color=blue&label=npx%20sovara)
  ![License](https://img.shields.io/badge/License-MIT-green.svg)
  ![Tech](https://img.shields.io/badge/Tech-Electron%20|%20Next.js-black)
</div>

<hr />

## 🚀 Live Demo (Sandbox)

👉 **[Try the Web Sandbox Demo](https://sovara-eight.vercel.app)**

> **Note:** The web version operates in a restricted browser sandbox. Local shell commands and filesystem edits are disabled. For the true, autonomous local experience, install the Desktop version below.

## 📌 About

SOVARA is an on-premise, offline-first AI workbench designed for confidential industrial work and agentic coding. It gives you a powerful LLM assistant that can read, write, and execute code directly on your local filesystem—without sending your intellectual property to the cloud.

This platform is built to demonstrate:
- **100% Privacy:** No telemetry, no cloud dependencies (unless using external APIs in Web Mode).
- **Agentic Capabilities:** Edits files, runs shell commands, and manages workspaces.
- **Hardware Agnosticism:** Dynamically optimizes local models based on your specific RAM/VRAM availability.

## ✨ Features

| Feature | Description |
| :--- | :--- |
| 💻 **True Local Execution** | Runs completely offline on your own hardware via Electron & Llama.cpp. |
| ⚡ **Hardware Optimization** | Auto-detects your GPU/CPU to dynamically load 4-bit (CPU) or 8-bit (GPU) models. |
| 🛡️ **Web Sandbox** | A beautiful Next.js web UI for cloud-based inference testing. |
| 🛠️ **Agentic Tools** | Full read/write filesystem access and terminal execution. |
| 📦 **Frictionless Setup** | 1-line PowerShell or NPX installation. |
| 🎨 **Modern UI** | Seamless, responsive dashboard with dark/light mode and session management. |

## 🛠️ Tech Stack

| Technology | Role |
| :--- | :--- |
| **Electron** | Desktop shell and local filesystem/OS bridge |
| **Next.js / React** | Frontend UI for both Web Sandbox and Desktop Renderer |
| **Node.js** | Local backend operations and hardware probing |
| **SQLite** | Durable session and conversation storage |
| **Llama.cpp** | Local model inference and execution engine |

## 📂 Project Structure

```text
📁 SOVARA
├── 📁 apps
│   ├── 📁 desktop      # Full local Electron app (True Autonomous Mode)
│   └── 📁 web          # Next.js Vercel deployment (Sandbox Demo Mode)
├── 📁 packages
│   └── 📁 sovara       # NPX 1-line installer package
└── 📁 docs             # Architecture and phase documentation
```

## 🚀 How to Use

### Option 1 — Web Sandbox (No Setup Required)
Perfect for testing the UI and chat capabilities without downloading the app.
👉 **[Open Web Demo](https://sovara-eight.vercel.app)**

### Option 2 — True Local Execution (Windows Only)
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
npx sovara
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
