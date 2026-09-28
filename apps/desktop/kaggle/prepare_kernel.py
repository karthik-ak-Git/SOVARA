"""Materialize the Kaggle kernel locally with the crashes fixed.

Two defects were found by inspection and one was reproduced locally with
peft 0.21.0 (the exact version the kernel pins):

  1. BLOCKER. Both adapter loads do
         PeftModel.from_pretrained(base_model, str(adapter_dir.parent),
                                   subfolder="main_lora", ...)
     `hf_hub_download` returned .../main_lora/adapter_model.safetensors, so
     `adapter_dir.parent` is ALREADY .../main_lora. peft then looks for
     .../main_lora/main_lora, does not find it, falls through to
     hf_hub_download() with a Windows path as the repo id, and raises:

       ValueError: Can't find 'adapter_config.json' at 'C:\\...\\main_lora'
       HFValidationError: Repo id must use alphanumeric chars, '-', '_' or '.'

     The kernel dies at Turn 1, before a single generation, so the A/B that
     this kernel exists to perform never happens. Fix: drop `subfolder`.

  2. The kernel hardcodes max_memory for GPU 0 AND GPU 1 and its own markdown
     says "2x T4", but the kernel's machineShape is `NvidiaTeslaT4` (single
     T4, 16 GB). The 31B in NF4 is ~16.5 GB, so device placement has to be
     derived from the hardware actually present rather than assumed.

Every edit asserts that it actually changed something, so a silent no-op
cannot masquerade as a fix.
"""
import json
import pathlib
import sys

SRC = pathlib.Path(sys.argv[1])          # the pulled kernel JSON
DST = pathlib.Path(sys.argv[2])          # local kernel dir
DST.mkdir(parents=True, exist_ok=True)

kernel = json.loads(SRC.read_text(encoding="utf-8"))
nb = json.loads(kernel["blob"]["source"])
meta = kernel["metadata"]

# ---------------------------------------------------------------- patch cells
def cell_text(cell):
    src = cell["source"]
    return src if isinstance(src, str) else "".join(src)

def set_cell_text(cell, text):
    cell["source"] = text.splitlines(keepends=True)

# Fix 1: drop the bogus subfolder on both adapter loads.
SUBS = [
    ('subfolder="main_lora"', "main_lora"),
    ('subfolder="tool_lora"', "tool_lora"),
]
n_sub = 0
for cell in nb["cells"]:
    if cell.get("cell_type") != "code":
        continue
    t = cell_text(cell)
    orig = t
    # Match the whole statement including its assignment target, so the rewrite
    # cannot leave a doubled `model = model =`.
    for var, ddir, needle, name in [
        ("model", "adapter_dir", 'subfolder="main_lora"', "main_lora"),
        ("model", "tool_dir",    'subfolder="tool_lora"', "tool_lora"),
    ]:
        old = (f'{var} = PeftModel.from_pretrained(base_model, str({ddir}.parent),\n'
               f'                                  {needle}, is_trainable=False)')
        new = (f'# `adapter_dir.parent` is already the .../{name} directory, so no\n'
               f'# "subfolder" kwarg here: peft would look for .../{name}/{name} and raise.\n'
               f'{var} = PeftModel.from_pretrained(base_model, str({ddir}.parent),\n'
               f'                                  is_trainable=False)')
        t = t.replace(old, new)
    if t != orig:
        n_sub += 1
        set_cell_text(cell, t)
assert n_sub == 2, f"expected to fix 2 adapter loads, patched {n_sub}"

# Fix 2: derive device placement from the GPUs actually present.
n_gpu = 0
for cell in nb["cells"]:
    if cell.get("cell_type") != "code":
        continue
    t = cell_text(cell)
    if 'max_memory={0: "13GiB", 1: "13GiB", "cpu": "26GiB"}' not in t:
        continue
    t = t.replace(
        'max_memory={0: "13GiB", 1: "13GiB", "cpu": "26GiB"},',
        'max_memory={**{i: "13GiB" for i in range(torch.cuda.device_count())},\n'
        '               "cpu": "26GiB"},')
    set_cell_text(cell, t)
    n_gpu += 1
assert n_gpu == 1, f"expected to fix 1 max_memory, patched {n_gpu}"

# ------------------------------------------------- stage 1b: fix the model id
# The kernel asked for `google/gemma-4/Other/gemma-4-31b-it-qat-w4a16-ct`.
# That repo does not exist: the Hub answers 401 for `google/gemma-4`, and 404
# for the full invented path. The real, ungated repo is the flat id
# `google/gemma-4-31b-it-qat-w4a16-ct` - and that is exactly the id the trained
# adapter itself records in its own `base_model_name_or_path`, so the adapter
# and the checkpoint do line up. v6 confirmed the failure from the runner:
#   RepositoryNotFoundError(401 ... /api/models/google/gemma-4)
# Try the candidates in order so a future rename degrades to a warning rather
# than a dead run.
n_base = 0
for cell in nb["cells"]:
    if cell.get("cell_type") != "code":
        continue
    t = cell_text(cell)
    if 'BASE = "google/gemma-4/Other/gemma-4-31b-it-qat-w4a16-ct"' not in t:
        continue
    t = t.replace(
        'BASE = "google/gemma-4/Other/gemma-4-31b-it-qat-w4a16-ct"   # what the harness serves',
        '# The `google/gemma-4/Other/...` path does not exist on the Hub. The\n'
        '# serving checkpoint is the flat id, which is also what the adapter\n'
        "# declares in its own base_model_name_or_path.\n"
        'BASE_CANDIDATES = [\n'
        '    "google/gemma-4-31b-it-qat-w4a16-ct",\n'
        '    "google/gemma-4-31b-it",\n'
        ']\n'
        'BASE = None\n'
        'for _cand in BASE_CANDIDATES:\n'
        '    try:\n'
        '        from huggingface_hub import HfApi\n'
        '        _i = HfApi().model_info(_cand)\n'
        '        print("base candidate OK:", _cand, "gated =", _i.gated)\n'
        '        BASE = _cand\n'
        '        break\n'
        '    except Exception as _e:\n'
        '        print("base candidate FAILED:", _cand, repr(_e)[:120])\n'
        'if BASE is None:\n'
        '    raise RuntimeError(f"no usable base checkpoint among {BASE_CANDIDATES}")\n'
        'diag("base_id", ok=True, repo=BASE)')
    set_cell_text(cell, t)
    n_base += 1
assert n_base == 1, f"expected to fix exactly 1 BASE assignment, fixed {n_base}"

# ---------------------------------------------------- stage 2: pin the stack
# v5 failed at the imports cell, and the runner told us exactly why:
#
#   ImportError: cannot import name 'as_extended_path' from
#                'huggingface_hub.utils._paths'
#
# transformers 5.17.0 imports that symbol, but its own metadata only declares
# `huggingface-hub<2.0,>=1.5.0`. Probing every published hub wheel shows the
# symbol exists in 2.0.0 and (per an import test) in 1.33.0, and in NONE of
# 0.36.2 / 1.5.0 / 1.10.2 / 1.15.0 / 1.20.1 / 1.24.0 / 1.28.0 / 1.29.0 - so
# Kaggle's preinstalled hub was simply too old for transformers 5.17.0.
#
# The original cell piped pip through `sh()`, which prints and returns a code
# that nobody checks, so a failed or partial install surfaced much later as an
# opaque ImportError. Pin every package, install transformers with --no-deps to
# bypass its incorrect <2.0 bound, and then VERIFY the import and raise.

PIP_OLD = ('sh(f"{sys.executable} -m pip uninstall -y torchao")\n'
           'sh(f"{sys.executable} -m pip install -q --upgrade "\n'
           '   f"transformers==5.17.0 peft==0.21.0 accelerate==1.13.0 bitsandbytes==0.50.2 "\n'
           '   f"compressed-tensors==0.19.0 huggingface_hub")')

PIP_NEW = '''# Pinned deliberately, and pinned with `==` only.
#
# v6 failed here with returncode 2, and the reason was in the output directory:
# a 0-byte file literally named `=0.23.1,`. `sh()` runs through `shell=True`, so
# a requirement written as `tokenizers>=0.23.1,<0.24.0` was split by the shell
# into a stdout redirect to a file named `=0.23.1,` plus an input redirect from
# `0.24.0`. The range never reached pip, tokenizers stayed at 0.22.2, and
# transformers 5.17.0 then refused to import because it needs >=0.23.1.
#
# Two changes: exact `==` pins (no shell metacharacters at all) and shlex.quote
# on top, so no future edit can reintroduce this.
#
# transformers 5.17.0 also needs `as_extended_path` from huggingface_hub, which
# no hub below 1.30 provides, while its own metadata claims
# `huggingface-hub<2.0,>=1.5.0`. --no-deps on transformers is what lets a 1.x
# hub satisfy it.
import shlex

WANT = {
    "transformers": "5.17.0",
    "huggingface_hub": "1.33.0",
    "tokenizers": "0.23.1",
    "safetensors": "0.8.0",
    "accelerate": "1.13.0",
    "peft": "0.21.0",
    "bitsandbytes": "0.50.2",
    "compressed-tensors": "0.19.0",
}
specs = [f"{k}=={v}" for k, v in WANT.items() if k != "transformers"]

rc = sh(f"{shlex.quote(sys.executable)} -m pip uninstall -y torchao")
rc |= sh(f"{shlex.quote(sys.executable)} -m pip install -q --no-deps "
         f"{shlex.quote('transformers==5.17.0')}")
rc |= sh(f"{shlex.quote(sys.executable)} -m pip install -q -U "
         + " ".join(shlex.quote(s) for s in specs))
diag("pip_install", ok=(rc == 0), returncode=rc, specs=specs)

# Do not trust pip's exit code: report what is ACTUALLY installed and fail here
# rather than three cells later with an opaque ImportError.
from importlib import metadata as _md
actual = {}
for k in WANT:
    try:
        actual[k] = _md.version(k)
    except Exception:
        actual[k] = None
bad = {k: (actual[k], v) for k, v in WANT.items() if actual[k] != v}
diag("stack_versions", ok=(not bad), installed=actual,
     mismatched={k: {"got": g, "want": w} for k, (g, w) in bad.items()})
if bad:
    raise RuntimeError(f"dependency install did not take: {bad}")

try:
    import huggingface_hub, transformers, peft, kagglehub
    from transformers import (AutoConfig, AutoProcessor, AutoModelForCausalLM,
                              BitsAndBytesConfig)
    diag("stack_imports", ok=True, hub=huggingface_hub.__version__,
         transformers=transformers.__version__, peft=peft.__version__,
         kagglehub=getattr(kagglehub, "__version__", "?"))
except Exception as _e:
    diag("stack_imports", ok=False, error=repr(_e)[:400])
    raise

# Probe the Hub in a SUBPROCESS. Doing it in-process would work, but a
# subprocess makes it impossible for this probe to influence - or be influenced
# by - the module cache the rest of the notebook depends on.
#
# `sh()` returns subprocess' returncode (an int), not its stdout, so calling
# .strip() on its result is the bug that killed v8 with
#   AttributeError("'int' object has no attribute 'strip'").
# Capture the stream directly instead.
import subprocess as _sp, json as _json2
_probe_src = (
    "import json, huggingface_hub;"
    "from huggingface_hub import HfApi;"
    "a = HfApi();"
    "print('PROBE ' + json.dumps({"
    "'hub': huggingface_hub.__version__,"
    "'repos': {c: (lambda r: {'gated': r.gated, 'private': r.private})(a.model_info(c))"
    "          for c in ['google/gemma-4-31b-it-qat-w4a16-ct', 'google/gemma-4-31b-it']}}))"
)
_p = _sp.run([sys.executable, "-c", _probe_src], capture_output=True, text=True, timeout=300)
_probe_line = next((l for l in (_p.stdout or "").splitlines() if l.startswith("PROBE ")), "")
if _p.returncode != 0 or not _probe_line:
    diag("hub_probe", ok=False, returncode=_p.returncode,
         stderr=(_p.stderr or "")[-400:])
else:
    try:
        diag("hub_probe", ok=True, **json.loads(_probe_line[len("PROBE "):]))
    except Exception as _e:
        diag("hub_probe", ok=False, error=repr(_e)[:200], raw=_probe_line[:300])
'''

n_pip = 0
for cell in nb["cells"]:
    if cell.get("cell_type") != "code":
        continue
    t = cell_text(cell)
    if PIP_OLD not in t:
        continue
    t = t.replace(PIP_OLD, PIP_NEW)
    set_cell_text(cell, t)
    n_pip += 1
assert n_pip == 1, f"expected to pin exactly 1 pip cell, patched {n_pip}"


# ------------------------------------------------------- stage 3: self-diagnose
# The v4 run failed with an EMPTY log: Kaggle produced only data/tasks.jsonl
# (129 tasks, so the data step succeeded) and a 0-byte .log, which tells us
# nothing about the actual exception. A blind rerun would burn the same quota
# and return the same silence.
#
# So: install an excepthook that persists any uncaught traceback to
# /kaggle/working/diagnostics.json, and record each risky step as it happens.
# Failures then arrive as data instead of as an empty log.

DIAG_CELL = '''import json as _json, pathlib as _pl, traceback as _tb

WORK = _pl.Path("/kaggle/working"); WORK.mkdir(parents=True, exist_ok=True)
DIAG_PATH = WORK / "diagnostics.json"
DIAG = []

def diag(step, ok=True, **kw):
    """Append a step result and flush it to disk immediately."""
    rec = {"step": step, "ok": bool(ok)}
    rec.update(kw)
    DIAG.append(rec)
    DIAG_PATH.write_text(_json.dumps(DIAG, indent=1, default=str), encoding="utf-8")
    print(f"[diag] {step} ok={ok} {kw if not ok else ''}", flush=True)
    return rec

def _hook(exc_type, exc, tb):
    diag("UNCAUGHT:" + getattr(exc_type, "__name__", "?"), ok=False,
         error=str(exc)[:800],
         traceback="".join(_tb.format_tb(tb))[-2500:])
    sys.__excepthook__(exc_type, exc, tb)

sys.excepthook = _hook

# NOTE: deliberately NO huggingface_hub import in this cell.
#
# v6 and v7 both installed huggingface_hub==1.33.0 (importlib.metadata confirmed
# it) and then still raised
#   ImportError: cannot import name 'as_extended_path' from
#                'huggingface_hub.utils._paths'
# ...even though 1.32.0+ does provide that symbol. Cause: this cell used to do
# `from huggingface_hub import HfApi` to probe the base repo, which ran BEFORE
# the pip cell and cached the runner's preinstalled (too old) hub in
# sys.modules. The later install replaced the files on disk, but `import
# huggingface_hub` in the same process kept handing back the cached old module.
#
# So: touch os.environ only here, and probe the Hub after the install, from a
# subprocess, so nothing can poison the parent's module cache.
import os as _os
if _os.environ.get("HF_TOKEN"):
    diag("hf_token_present", ok=True)
else:
    diag("hf_token_present", ok=False, note="no HF_TOKEN in the runner environment")
'''

# Insert the diagnostics cell right after the first code cell (the imports).
code_idx = [i for i, c in enumerate(nb["cells"]) if c.get("cell_type") == "code"]
assert code_idx, "no code cells found"
ins = code_idx[0] + 1
diag_cell = {"cell_type": "code", "id": "diag-001", "execution_count": None,
             "metadata": {}, "outputs": [], "source": DIAG_CELL.splitlines(keepends=True)}
nb["cells"].insert(ins, diag_cell)

# Record the model download explicitly; keep the original raise semantics so a
# real failure is still a failure.
n_dl = 0
for cell in nb["cells"]:
    if cell.get("cell_type") != "code":
        continue
    t = cell_text(cell)
    old = ('t0 = time.time()\n'
           'model_path = pathlib.Path(kagglehub.model_download(BASE))\n'
           'print(f"base: {model_path}  {time.time() - t0:.0f}s")')
    if old not in t:
        continue
    new = ('t0 = time.time()\n'
           'try:\n'
           '    model_path = pathlib.Path(kagglehub.model_download(BASE))\n'
           '    print(f"base: {model_path}  {time.time() - t0:.0f}s")\n'
           '    diag("model_download", ok=True, path=str(model_path))\n'
           'except Exception as _e:\n'
           '    diag("model_download", ok=False, error=repr(_e)[:400])\n'
           '    raise')
    t = t.replace(old, new)
    # The tasks step already has a fallback; log which path it took.
    t = t.replace('print(f"{len(tasks)} dev tasks")',
                  'diag("tasks_loaded", ok=True, n=len(tasks))\n'
                  'print(f"{len(tasks)} dev tasks")')
    set_cell_text(cell, t)
    n_dl += 1
assert n_dl == 1, f"expected to instrument 1 model-download cell, got {n_dl}"

# sys.excepthook is NOT enough: ipykernel catches a failing cell and renders
# the traceback itself, so the hook never fires and the run still dies silently.
# Wrap every subsequent code cell instead, which is the one mechanism that
# reliably observes a cell failure. Re-raise so a real failure stays a failure.
def wrap_cell(text, label):
    lines = text.splitlines(keepends=True)
    body = "".join("    " + ln if ln.strip() else ln for ln in lines)
    # Record the success too, so a partial run still shows exactly how far it
    # got rather than only where it stopped.
    return ("try:\n" + body +
            "\nexcept BaseException as _e:\n"
            f"    diag({label!r}, ok=False, error=repr(_e)[:400])\n"
            "    raise\n"
            f"diag({label!r}, ok=True)\n")

n_wrap = 0
expected_wrap = 0
for i, cell in enumerate(nb["cells"]):
    if cell.get("cell_type") != "code":
        continue
    if cell is diag_cell or i == code_idx[0]:
        continue
    t = cell_text(cell)
    if t.lstrip().startswith("try:"):
        continue
    expected_wrap += 1
    set_cell_text(cell, wrap_cell(t, f"cell_{i}"))
    n_wrap += 1
# Every code cell except the import cell and the diagnostics cell must be
# wrapped; anything less means a cell was silently skipped.
total_code = sum(1 for c in nb["cells"] if c.get("cell_type") == "code")
assert n_wrap == expected_wrap == total_code - 2, \
    f"wrapped {n_wrap}, expected {expected_wrap}, code cells {total_code}"

# ------------------------------------------------- stage 1c: use the right API
# v9 reached the download with a correct, reachable, ungated repo id and still
# failed:
#   ValueError: Invalid model handle: google/gemma-4-31b-it-qat-w4a16-ct
# `kagglehub.model_download` resolves Kaggle *Models* handles, not Hub repo
# ids. The checkpoint lives on the Hub (the Hub probe in the same run reported
# gated=false for it), so it has to come from huggingface_hub.
#
# This stage runs LAST, after the instrumentation and wrapping stages: an
# earlier attempt ran before them and was silently undone, because the
# instrumentation re-inserts the original `kagglehub.model_download(BASE)` line
# as part of the text it matches. The pattern below is indentation-agnostic so
# it survives the 4-space indent that wrapping adds.
import re as _re

n_dl_api = 0
for cell in nb["cells"]:
    if cell.get("cell_type") != "code":
        continue
    t = cell_text(cell)
    if "kagglehub.model_download" not in t:
        continue
    # Swap the call, keeping whatever indentation the cell currently has.
    t2 = _re.sub(r"pathlib\.Path\(kagglehub\.model_download\(BASE\)\)",
                 "pathlib.Path(snapshot_download(BASE, max_workers=8))", t)
    assert t2 != t, "kagglehub.model_download(BASE) did not match"
    # Add the import next to the call, at the same indent as the statement.
    m = _re.search(r"^([ \t]*)model_path = pathlib\.Path\(snapshot_download",
                   t2, _re.M)
    assert m, "could not locate the rewritten model_path line"
    ind = m.group(1)
    t2 = t2.replace(f"{ind}model_path = pathlib.Path(snapshot_download",
                    f"{ind}# kagglehub.model_download only understands Kaggle Models\n"
                    f"{ind}# handles, so it rejected the Hub repo id outright.\n"
                    f"{ind}from huggingface_hub import snapshot_download\n"
                    f"{ind}model_path = pathlib.Path(snapshot_download", 1)
    set_cell_text(cell, t2)
    n_dl_api += 1
assert n_dl_api == 1, f"expected to fix 1 model download call, fixed {n_dl_api}"
# Check code only: the replacement deliberately leaves a comment NAMING the old
# API, so a raw substring search would trip over the explanation.
_live = "\n".join(
    ln.split("#", 1)[0]
    for c in nb["cells"] if c.get("cell_type") == "code"
    for ln in cell_text(c).splitlines())
assert "kagglehub.model_download" not in _live, \
    "a live kagglehub.model_download call survived"

# -------------------------------------------- stage 1d: record the real shape
# v11 died at cell_7 with CUDA OOM: "GPU 0 has a total capacity of 14.56 GiB of
# which 30.81 MiB is free". A 31B in NF4 is ~16.5-17 GB of weights, so it does
# not fit on one T4 no matter how the device map is arranged, and bitsandbytes
# 4-bit layers cannot be offloaded to CPU (bnb needs CUDA). The kernel needs two
# GPUs - which is what its own markdown ("2x T4") and its original
# max_memory={0: .., 1: ..} always assumed.
#
# Record what the runner actually granted so an OOM is diagnosable after the
# fact instead of requiring a rerun to guess.
n_gpu = 0
for cell in nb["cells"]:
    if cell.get("cell_type") != "code":
        continue
    t = cell_text(cell)
    if "max_memory=" not in t:
        continue
    indent = " " * 4
    t = t.replace(
        f"{indent}base_model = AutoModelForCausalLM.from_pretrained(",
        f"{indent}_ngpu = torch.cuda.device_count()\n"
        f"{indent}_tot = [round(torch.cuda.get_device_properties(i).total_memory / 2**30, 2)\n"
        f"{indent}          for i in range(_ngpu)]\n"
        f"{indent}diag(\"gpu_shape\", ok=(_ngpu >= 2), device_count=_ngpu,\n"
        f"{indent}     total_gib_per_device=_tot,\n"
        f"{indent}     names=[torch.cuda.get_device_name(i) for i in range(_ngpu)],\n"
        f"{indent}     note=('a 31B in NF4 needs ~16.5-17GB of VRAM; a single 16GB T4 is not enough'\n"
        f"{indent}           if _ngpu < 2 else 'two GPUs available'))\n"
        f"{indent}base_model = AutoModelForCausalLM.from_pretrained(", 1)
    set_cell_text(cell, t)
    n_gpu += 1
assert n_gpu == 1, f"expected to instrument 1 model-load cell, got {n_gpu}"

# ------------------------------------------------------------------- write out
# Every code cell must still be valid Python. A patch that breaks the syntax
# would waste a full GPU run to discover.
import ast
for i, cell in enumerate(nb["cells"]):
    if cell.get("cell_type") != "code":
        continue
    t = cell_text(cell)
    try:
        ast.parse(t)
    except SyntaxError as e:
        raise SystemExit(f"cell {i} is not valid Python after patching: {e}")

# No real subfolder kwarg may survive on a PeftModel load.
for i, cell in enumerate(nb["cells"]):
    if cell.get("cell_type") != "code":
        continue
    for line in cell_text(cell).splitlines():
        code = line.split("#", 1)[0]
        if "PeftModel.from_pretrained" in code or (code.strip() and "subfolder=" in code
                                                   and "from_pretrained" in code):
            assert "subfolder=" not in code, f"cell {i} still passes subfolder: {line!r}"
assert not any("model = model =" in cell_text(c) for c in nb["cells"]), \
    "a doubled assignment survived the rewrite"

nb_path = DST / "sf-gemma4-adapter-test.ipynb"
nb_path.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")

km = {
    "id": meta["ref"],
    "title": meta["title"],
    "code_file": nb_path.name,
    "language": "python",
    "kernel_type": "notebook",
    "is_private": True,
    "enable_gpu": True,
    "enable_tpu": False,
    "enable_internet": True,
}
(DST / "kernel-metadata.json").write_text(json.dumps(km, indent=1), encoding="utf-8")

print(f"kernel   : {meta['ref']}  (private, gpu, internet; was v{meta['currentVersionNumber']})")
print(f"notebook : {nb_path}  ({len(nb['cells'])} cells)")
print(f"patched  : {n_sub} adapter loads, {n_gpu} max_memory, "
      f"{n_wrap} cells wrapped for diagnostics, 1 diagnostics cell inserted")
print("all code cells parse as Python, no subfolder kwarg survives, no doubled assignment")
