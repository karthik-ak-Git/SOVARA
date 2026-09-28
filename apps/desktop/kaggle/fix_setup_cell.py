"""Rewrite the CODE_SETUP block in vllm_cells.py, then verify it parses.

The block was edited in place until it stopped parsing. This regenerates it
from scratch, using a plain ''' string for the outer literal so the inner
docstrings need no escaping, then asserts the module and the cell both parse
and that the cell does not import torch before the vLLM install.
"""
import ast
import io
import pathlib

P = pathlib.Path(__file__).parent / "vllm_cells.py"

BLOCK = (
    'CODE_SETUP = ' + "'''" + '''import os
import sys, time, json, pathlib, subprocess
import kagglehub

# Deliberately NO `import torch` in this cell.
#
# The vLLM install REPLACES the runner's torch: on v15 `pip install --upgrade
# vllm` pulled 99 packages including vllm-0.30.0 and torch-2.13.0, displacing
# the image's torch 2.10.0+cu128. Importing torch before that install leaves
# this process holding a build the new vLLM does not expect, which is what
# raised, on v15:
#     RuntimeError: function '_has_torch_function' already has a docstring
#
# So torch is first imported in the ENGINE cell, after the install. GPU facts
# come from a throwaway subprocess instead: one extra process, and this
# interpreter stays clean for the install.

WORK = pathlib.Path("/kaggle/working")
WORK.mkdir(parents=True, exist_ok=True)
DIAG_PATH = WORK / "diagnostics.json"
DIAG = []


def diag(step, ok=True, **kw):
    """Append a step result and flush it to disk immediately."""
    rec = {"step": step, "ok": bool(ok)}
    rec.update(kw)
    DIAG.append(rec)
    DIAG_PATH.write_text(json.dumps(DIAG, indent=1, default=str), encoding="utf-8")
    print("[diag] " + step + " ok=" + str(ok) + " " + (str(kw) if not ok else ""),
          flush=True)
    return rec


def run(cmd, timeout=3600):
    """Run a command, streaming its tail. Returns the returncode."""
    print("$ " + cmd, flush=True)
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                       timeout=timeout)
    print((p.stdout or "")[-3000:], flush=True)
    if p.returncode != 0:
        print((p.stderr or "")[-3000:], flush=True)
    return p.returncode


_GPU_SRC = """
import json, torch
n = torch.cuda.device_count()
print('G ' + json.dumps({
  'torch': torch.__version__, 'cuda': torch.version.cuda,
  'gpus': [torch.cuda.get_device_name(i) for i in range(n)],
  'total_gib': [round(torch.cuda.get_device_properties(i).total_memory / 2**30, 2)
               for i in range(n)]}))
"""


def _gpu_facts():
    # Read torch/GPU facts in a throwaway interpreter, not this one.
    p = subprocess.run([sys.executable, "-c", _GPU_SRC],
                       capture_output=True, text=True, timeout=600)
    ln = next((l for l in (p.stdout or "").splitlines() if l.startswith("G ")), "")
    try:
        return json.loads(ln[2:])
    except Exception as e:
        return {"error": "{}: {}".format(type(e).__name__, e), "rc": p.returncode,
                "stderr": (p.stderr or "")[-400:]}


diag("env", ok=True, python=sys.version.split()[0], **_gpu_facts())
''' + "'''" + "\n\n"
)

lines = io.open(P, encoding="utf-8").read().split("\n")
start = next(i for i, l in enumerate(lines) if l.startswith("CODE_SETUP = "))
end = next(i for i, l in enumerate(lines) if l.startswith("CODE_INSTALL = "))
lines[start:end] = BLOCK.split("\n")
io.open(P, "w", encoding="utf-8").write("\n".join(lines))

# ---- verify -------------------------------------------------------------
src = io.open(P, encoding="utf-8").read()
ast.parse(src)
mod = {}
exec(compile(ast.parse(src), "vllm_cells", "exec"), mod)
setup = mod["CODE_SETUP"]
ast.parse(setup)
# "import torch" may appear inside _GPU_SRC (the subprocess probe string).
# What must not happen is torch being imported IN THIS PROCESS, which is what
# breaks after the vllm install replaces it. Check executable code only.
# Blank out the _GPU_SRC triple-quoted block: it legitimately mentions torch,
# but it is a string handed to a subprocess, never imported here.
_lines = setup.splitlines()
_out, _in_gpu = [], False
for _l in _lines:
    if _l.startswith("_GPU_SRC = "):
        _in_gpu = True
        continue
    if _in_gpu:
        if _l.strip() == '"""':
            _in_gpu = False
        continue
    _out.append(_l.split("#", 1)[0])
_live = "\n".join(_out)
assert "import torch" not in _live, "CODE_SETUP imports torch in-process"
assert "torch.cuda" not in _live, "CODE_SETUP touches torch.cuda in-process"
assert "def diag(" in setup and "_gpu_facts" in setup
assert "def vllm_state(" not in setup

# every other code cell must parse too
for name, val in mod.items():
    if name.startswith("CODE_") and isinstance(val, str) and name != "CODE_SETUP":
        ast.parse(val)
print("module parses")
print("CODE_SETUP parses, defines diag/_gpu_facts, does not import torch")
print("all CODE_* cells parse")
