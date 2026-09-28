"""Check the vLLM 0.30.0 API surface that the kernel depends on.

v13 installed vLLM (pip rc=0) and still reported version=None, gemma4=False. Two
candidate causes, and they need different fixes:
  A. `import vllm` in a plain interpreter fails for an unrelated reason (no
     GPU, or a torch build mismatch), so the version probe is simply the wrong
     test on a GPU-less laptop.
  B. `ModelRegistry.get_supported_archs()` is not the real API, so the Gemma 4
     check was always False regardless of what is installed.

Answer both by downloading the wheel and reading it, plus attempting the import
in a subprocess and capturing WHY it fails.
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import zipfile

PROBE = "_vllmpkg"
shutil.rmtree(PROBE, ignore_errors=True)
os.makedirs(PROBE, exist_ok=True)

# ---- 1. does the import even work here, and if not, why? --------------------
p = subprocess.run([sys.executable, "-c", "import vllm; print(vllm.__version__)"],
                   capture_output=True, text=True)
print("=== import vllm in this interpreter ===")
print("  rc:", p.returncode)
print("  stdout:", (p.stdout or "").strip()[:200])
err = (p.stderr or "").strip()
tail = [l for l in err.splitlines() if l.strip()][-4:]
print("  stderr tail:")
for l in tail:
    print("     ", l[:150])
print("  -> this machine has no GPU, so a local import failure here says nothing")
print("     about Kaggle. The kernel must judge by registry contents, not by import.")

# ---- 2. what does the registry actually expose? -----------------------------
print("\n=== registry API in the published wheel ===")
r = subprocess.run(f"{sys.executable} -m pip download vllm==0.30.0 --no-deps -d {PROBE} -q",
                   shell=True, capture_output=True, text=True)
whls = glob.glob(f"{PROBE}/vllm-*.whl")
if not whls:
    print("  download failed:", (r.stderr or "")[-200:])
else:
    print("  wheel:", os.path.basename(whls[0]))
    with zipfile.ZipFile(whls[0]) as z:
        names = z.namelist()
        reg = [n for n in names if n.endswith("model_executor/models/registry.py")]
        print("  registry.py present:", bool(reg))
        if reg:
            src = z.read(reg[0]).decode("utf-8", "replace")
            import re
            print("  public API found:")
            for m in re.finditer(r"^(\s*)def (get_supported\w+|inspect_model_cls|resolve_model_cls)\(.*", src, re.M):
                print("     def", m.group(2))
            print("  ModelRegistry instantiation lines:")
            for ln in src.splitlines():
                if "ModelRegistry = " in ln or "_ModelRegistry(" in ln:
                    print("     ", ln.strip()[:110])
            print("  Gemma4 registered:", "Gemma4" in src)
            for ln in src.splitlines():
                if "Gemma4" in ln:
                    print("     ", ln.strip()[:130])
        g4 = [n for n in names if "gemma4" in n.lower()]
        print("  gemma4 model files:", [os.path.basename(x) for x in g4][:10])

shutil.rmtree(PROBE, ignore_errors=True)
