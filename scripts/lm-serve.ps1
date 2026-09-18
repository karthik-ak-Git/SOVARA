# lm-serve.ps1 — Windows parity of lm-serve.sh auto-tuner
# Usage: .\lm-serve.ps1 <model.gguf> [ctxSize] [extra llama-server args...]
param([Parameter(Mandatory=$true)][string]$Model, [int]$Ctx=8192, [Parameter(ValueFromRemainingArguments=$true)][string[]]$ExtraArgs)
$ErrorActionPreference='Stop'
if (!(Test-Path $Model)) { throw "Model not found: $Model" }
$exe = if ($env:LLAMA_SERVER) { $env:LLAMA_SERVER } else { "$HOME\llama.cpp\build\bin\llama-server.exe" }
$port = if ($env:PORT) { $env:PORT } else { 8080 }
$cores = (Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
$phys = [math]::Round($cores/2)
$ramGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
$vramMB = 0; try { $v = nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1; $vramMB=[int]$v.Trim() } catch {}
Write-Host "Detected: $phys physical cores, ${ramGB}GB RAM, ${vramMB}MB VRAM"
$modelGB = [math]::Round((Get-Item $Model).Length / 1GB,2)
$args = @("--port",$port,"--host","0.0.0.0","--ctx-size",$Ctx,"--batch-size","2048","--ubatch-size","512","--flash-attn","--cache-type-k","q8_0","--cache-type-v","q8_0","--cache-reuse","256","--parallel","4","--cont-batching","--threads",$phys,"--model",$Model)
if ($vramMB -gt 0) { $args += @("--n-gpu-layers","999") }
if ($ExtraArgs) { $args += $ExtraArgs }
Write-Host "-> $exe $($args -join ' ')"
& $exe @args
