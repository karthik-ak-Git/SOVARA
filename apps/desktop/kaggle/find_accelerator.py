"""Find the valid values for `kaggle kernels push --accelerator`.

The 31B needs ~17 GB of VRAM in NF4. The runner handed out a single device with
14.56 GiB total, so the model does not fit and cell_7 died with
CUDA OOM. The notebook's own markdown already says "2x T4" and its original
max_memory named GPU 0 AND GPU 1, so 2x T4 is the intended shape - the kernel
was simply configured with one.
"""
import glob
import os
import re

import kagglesdk

base = os.path.dirname(kagglesdk.__file__)
hits = 0
for f in glob.glob(base + "/**/*.py", recursive=True):
    try:
        s = open(f, encoding="utf-8", errors="ignore").read()
    except OSError:
        continue
    if "T4" not in s:
        continue
    lines = [ln.strip() for ln in s.splitlines() if "T4" in ln]
    if not lines:
        continue
    print("FILE:", f.replace(base, "kagglesdk"))
    for ln in lines[:12]:
        print("   ", ln[:130])
    hits += 1
    if hits >= 6:
        break

if not hits:
    print("no accelerator enum found in the sdk; falling back to a live probe")

# Also dump whatever enum-looking names mention 'accelerator' anywhere.
print("\n=== any symbol containing 'ccelerator' ===")
seen = set()
for f in glob.glob(base + "/**/*.py", recursive=True):
    try:
        s = open(f, encoding="utf-8", errors="ignore").read()
    except OSError:
        continue
    for m in re.finditer(r"class\s+(\w*[Aa]ccelerator\w*)\b", s):
        seen.add(m.group(1))
print(sorted(seen) or "none")
