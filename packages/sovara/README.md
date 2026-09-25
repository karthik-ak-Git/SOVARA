# Sovara Windows installer

`sovara` is a small Node.js CLI installer. It downloads the latest Windows release asset, verifies its SHA-256 digest when GitHub provides one, and launches the setup wizard.

## Usage

```powershell
npx --yes sovara@latest
```

The command:

1. Fetches the `Sovara-versions` release metadata.
2. Selects the Sovara Windows `.exe` installer.
3. Downloads it to a temporary directory.
4. Verifies the release digest when available.
5. Launches the installer directly without a shell command string.

Sovara requires Windows x64. Node.js is needed only for this installer command; the installed desktop application does not require Python, LM Studio, Ollama, or a separate Node.js runtime.
