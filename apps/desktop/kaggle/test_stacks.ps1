$ErrorActionPreference = "Continue"
$root = "D:\SOVARA\apps\desktop\kaggle"
Set-Location $root

function Test-Stack($name, $specs, $useNoDeps) {
  $venv = Join-Path $root "venv_$name"
  Remove-Item $venv -Recurse -Force -ErrorAction SilentlyContinue
  python -m venv --system-site-packages $venv | Out-Null
  $py = Join-Path $venv "Scripts\python.exe"
  if (-not (Test-Path $py)) { "$name : venv creation FAILED"; return }

  foreach ($s in $specs) {
    $flag = if ($useNoDeps -and $s -match "transformers") { "--no-deps" } else { "" }
    & $py -m pip install -q $flag $s 2>&1 | Out-Null
  }

  $code = @'
import json, traceback
res = {}
try:
    import huggingface_hub, transformers, peft
    res["hub"] = huggingface_hub.__version__
    res["transformers"] = transformers.__version__
    res["peft"] = peft.__version__
    from transformers import AutoConfig, AutoProcessor, AutoModelForCausalLM, BitsAndBytesConfig
    res["import_transformers_api"] = "OK"
except Exception as e:
    res["error"] = f"{type(e).__name__}: {e}"
try:
    import kagglehub
    res["kagglehub"] = getattr(kagglehub, "__version__", "?")
except Exception as e:
    res["kagglehub_error"] = f"{type(e).__name__}: {e}"
print("RESULT_JSON " + json.dumps(res))
'@
  $code | Set-Content (Join-Path $root "_probe.py") -Encoding UTF8
  $out = & $py (Join-Path $root "_probe.py") 2>&1 | Out-String
  $line = ($out -split "`n" | Where-Object { $_ -match "RESULT_JSON" } | Select-Object -First 1)
  if ($line) {
    $json = $line -replace ".*RESULT_JSON ", ""
    "=== STACK $name ==="
    $json
  } else {
    "=== STACK $name ==="
    "  no result; raw tail:"
    ($out -split "`n" | Select-Object -Last 6) -join "`n"
  }
  Remove-Item $venv -Recurse -Force -ErrorAction SilentlyContinue
}

# A: keep the notebook's transformers 5.17.0, satisfy its real need (hub 2.0.0)
#    by installing transformers with --no-deps so its own bad <2.0 bound is bypassed.
Test-Stack "A_hub2" @(
  "huggingface_hub==2.0.0",
  "transformers==5.17.0",
  "peft==0.21.0",
  "tokenizers>=0.23.1,<0.24.0",
  "safetensors>=0.8.0"
) $true

# B: fall back to the combination that is already proven importable on this
#    machine (transformers 5.16.1 with hub 1.29.0).
Test-Stack "B_tf516" @(
  "huggingface_hub==1.29.0",
  "transformers==5.16.1",
  "peft==0.21.0",
  "tokenizers>=0.23.1,<0.24.0",
  "safetensors>=0.8.0"
) $true

Remove-Item (Join-Path $root "_probe.py") -Force -ErrorAction SilentlyContinue
