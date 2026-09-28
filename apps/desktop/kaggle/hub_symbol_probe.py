"""Locate the exact huggingface_hub version that provides `as_extended_path`.

Kaggle v6 and v7 both died on:
    ImportError: cannot import name 'as_extended_path' from
                 'huggingface_hub.utils._paths'

v6 had an unpinned hub; v7 pinned 1.33.0 (importlib.metadata confirmed 1.33.0
was installed) and it still failed. So the boundary is somewhere else. Read the
wheel directly - no install, no risk to the local environment.
"""
import glob
import os
import shutil
import subprocess
import sys
import zipfile

VERSIONS = ["1.29.0", "1.30.0", "1.31.0", "1.32.0", "1.33.0", "2.0.0"]
PROBE = "_hubprobe"


def symbol_version(version):
    shutil.rmtree(PROBE, ignore_errors=True)
    os.makedirs(PROBE, exist_ok=True)
    subprocess.run(
        f"{sys.executable} -m pip download huggingface_hub=={version} --no-deps -d {PROBE} -q",
        shell=True, capture_output=True, text=True)
    whls = glob.glob(f"{PROBE}/huggingface_hub-*.whl")
    if not whls:
        return None
    with zipfile.ZipFile(whls[0]) as z:
        src = z.read("huggingface_hub/utils/_paths.py").decode("utf-8", "replace")
    return "as_extended_path" in src


print("hub        as_extended_path")
print("-" * 32)
good = []
for v in VERSIONS:
    r = symbol_version(v)
    print(f"{v:<10} {str(r):<10}")
    if r:
        good.append(v)

shutil.rmtree(PROBE, ignore_errors=True)
print()
print("provides it:", ", ".join(good) or "NONE")
if good:
    print("-> pin huggingface_hub==" + good[0])
