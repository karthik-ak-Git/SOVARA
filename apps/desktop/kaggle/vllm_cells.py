"""Cell sources for the vLLM rewrite of sf-gemma4-adapter-test.

Why this exists, in the order the failures actually happened:

  v4  died with a 0-byte log. No diagnostics at all.
  v5  added diagnostics -> ImportError: cannot import name 'as_extended_path'
  v6  pinned transformers/peft, but the diagnostics cell had already imported
      the runner's old huggingface_hub, so the install was invisible to the
      running process. Same ImportError.
  v7  removed that import -> stack_imports finally OK, then
      ValueError: Invalid model handle. kagglehub.model_download only
      understands Kaggle Models handles, not Hub repo ids.
  v9  used snapshot_download -> the 23.3 GB checkpoint downloaded, 129 dev
      tasks loaded, then CUDA OOM on a single 14.56 GiB T4.
  v11 requested 2x T4 (granted: device_count 2, 14.56 GiB each) and still OOM'd
      at ~28.8 GiB, which means the bitsandbytes NF4 path was never actually
      applied to this Gemma4ForConditionalGeneration checkpoint.

That last one is the wall. The checkpoint is a compressed-tensors QAT int4
vision-language model; loading it through transformers + bitsandbytes does not
respect the BitsAndBytesConfig, and 31B at ~29 GB does not fit in 2x16 GB.

vLLM is the deployment stack - the notebook's own markdown says the harness
serves this checkpoint - and vLLM implements Gemma4ForConditionalGeneration
with SupportsLoRA, loading compressed-tensors int4 natively. The official
recipe for gemma-4-31B-it on this class of hardware is
`--tensor-parallel-size 2`, which is exactly what the runner granted.

What is preserved from the original notebook, unchanged, so the A/B still means
the same thing: SYSTEM_MAIN, SYSTEM_TOOL, render_user, tool_prompt, the
chat-template rendering with enable_thinking=True, the 6..60 changed-line task
band, the one-task-per-repo spread, FOLLOWUPS, the ```diff detection, and the
tool_lora scored against the gold patch's files.

What changes: the engine. Generation goes through vLLM with an explicit
per-run seed, and prompts are passed as pre-tokenised ids (add_special_tokens
=False) so vLLM cannot add a second BOS and diverge from the training render.
"""

MD_TITLE = """# Does the adapter actually generate a good patch? (vLLM engine)

The 31B cannot run on a 6 GB laptop (4-bit base is ~16.5 GB; E2B was the local
workaround), so the adapters get tested where they were trained: Kaggle, 2x T4.

This is an honest A/B, not a demo reel:
  1. serve `google/gemma-4-31b-it-qat-w4a16-ct` on vLLM, tensor-parallel 2
  2. pull `main_lora` / `tool_lora` from the public HF repo we published
  3. take real dev tasks from `tasks.jsonl`
  4. render the prompt exactly as training did (same system prompt, same chat
     template, same `enable_thinking`), then generate with and without the
     adapter and print both side by side

What we are looking for: the adapter's output should be a short `LOCATE/CAUSE/
CHANGE` plan followed by a fenced unified diff. The base model, left to itself,
tends to write prose or invent file paths - that difference is the whole point
of the fine-tune.

**Engine change, and why.** This used to load the checkpoint through
transformers + bitsandbytes NF4. On this runner that path did not apply the 4-bit
quantisation at all: with 2x T4 granted (14.56 GiB each) the load still ran to
~28.8 GB and died with CUDA OOM, which is 31B in roughly fp16, not in NF4. The
checkpoint is a compressed-tensors QAT int4 vision-language model, and vLLM
implements `Gemma4ForConditionalGeneration` with LoRA support and loads that
quantisation natively. vLLM is also what the scoring harness uses. Prompts,
tasks, and scoring are unchanged."""

MD_DIAG = """## Diagnostics

Every step writes to `diagnostics.json` as it happens, and each cell is wrapped
so a failure is recorded rather than lost. The previous seven versions all
failed in ways the output files did not describe - one of them produced an
empty log and nothing else."""

CODE_SETUP = '''import os
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
'''


CODE_INSTALL = '''import importlib
# vLLM install, and the reason it is done the way it is.
#
# v15 got furthest and still failed, with:
#   RuntimeError: function '_has_torch_function' already has a docstring
# The log explains it. `pip install --upgrade vllm` exited 0 and installed 99
# packages including:
#     vllm-0.30.0  torch-2.13.0  torchvision-0.28.0  transformers-5.17.0
# It REPLACED the runner's torch 2.10.0+cu128 with a 2.13.0 build, but this
# kernel process had already imported torch 2.10.0 at setup time. Two torch
# builds in one process is what produces the duplicated docstring error.
#
# That is the same class of bug as v6 and v7: install in-process, then keep
# using a process that was born before the install. The fix is to stop sharing
# the process. Install and verify in a subprocess, then - because the engine
# genuinely needs the new torch in THIS process - restart cleanly by
# re-executing the kernel with a marker file, so every cell after the install
# runs in a fresh interpreter that has never imported the old torch.
#
# Step 1: install in a subprocess and report the real result.
import textwrap
INSTALL_MARKER = WORK / ".vllm_installed.json"

if not INSTALL_MARKER.exists():
    # torchao 0.10 (pre-installed) collides with vLLM's quant dispatcher.
    run(f"{sys.executable} -m pip uninstall -y torchao")
    # Let vLLM choose its own torch: installing it first and vllm second in one
    # resolver pass is what produces a self-consistent set.
    rc = run(f"{sys.executable} -m pip install --upgrade vllm", timeout=5400)

    # Verify in a FRESH interpreter, not this one.
    #
    # v16 failed here for a self-inflicted reason: this cell is wrapped in
    # try/except and re-indented, so a triple-quoted literal written flush-left
    # arrives with leading whitespace on every line. The generated _probe.py
    # then died with
    #     IndentationError: unexpected indent
    # before importing anything. textwrap.dedent undoes the wrapping indent.
    probe = textwrap.dedent("""
    import json, sys
    try:
        import torch
        tv = torch.__version__
    except Exception as e:
        print("PROBE " + json.dumps({"ok": False, "where": "torch",
                                     "error": repr(e)[:300]}))
        raise SystemExit(0)
    try:
        import vllm
        from vllm.model_executor.models.registry import ModelRegistry
        archs = [a for a in ModelRegistry.get_supported_archs() if "Gemma4" in a]
        print("PROBE " + json.dumps({"ok": bool(archs), "torch": tv,
                                     "vllm": vllm.__version__,
                                     "cuda": torch.version.cuda, "gemma4": archs}))
    except Exception as e:
        print("PROBE " + json.dumps({"ok": False, "where": "vllm", "torch": tv,
                                     "error": repr(e)[:600]}))
    """).lstrip()
    (WORK / "_probe.py").write_text(probe, encoding="utf-8")
    p = subprocess.run([sys.executable, str(WORK / "_probe.py")],
                       capture_output=True, text=True, timeout=1800)
    line = next((l for l in (p.stdout or "").splitlines() if l.startswith("PROBE ")), "")
    try:
        state = json.loads(line[len("PROBE "):])
    except Exception:
        state = {"ok": False, "error": f"probe produced no result; rc={p.returncode}",
                 "stderr": (p.stderr or "")[-800:]}
    diag("vllm_subprocess_probe", ok=bool(state.get("ok")),
         pip_rc=rc, state=state)

    if state.get("ok"):
        # Record the verified versions. No restart is needed: the setup cell
        # deliberately avoids importing torch, so this interpreter has never
        # touched the old build and will pick up the new one on first import.
        INSTALL_MARKER.write_text(json.dumps(state), encoding="utf-8")
        diag("vllm_ready", ok=True, state=state)
    else:
        raise RuntimeError(
        "vLLM install did not yield a working import in a fresh interpreter. "
        f"pip rc={rc}; state={json.dumps(state)[:900]}")

# Step 2: repair protobuf BEFORE importing vllm's entry point in this process.
#
# v17 installed vLLM fine (torch 2.13.0+cu130, vllm 0.30.0, all five Gemma4
# architectures registered) and then died on this very import with:
#   VersionError: Detected mismatched Protobuf Gencode/Runtime major versions
#   when loading google/protobuf/duration.proto: gencode 7.36.2 runtime 5.29.5
#
# The gencode is 7.36.2, the runtime is 5.29.5: a descriptor compiled into a
# package that arrived with the vLLM install needs protobuf 7, but the runner's
# protobuf library is 5.29.5. Mismatched majors are rejected outright. The
# subprocess probe passed only because a bare `import vllm` never loads those
# descriptors; `from vllm import LLM` does.
def _protobuf_version():
    p = subprocess.run([sys.executable, "-c",
                        "import google.protobuf as g; print('PB ' + g.__version__)"],
                       capture_output=True, text=True, timeout=300)
    ln = next((l for l in (p.stdout or "").splitlines() if l.startswith("PB ")), "")
    return ln[3:].strip() if ln else None

def _protobuf_version():
    p = subprocess.run([sys.executable, "-c",
                        "import google.protobuf as g; print('PB ' + g.__version__)"],
                       capture_output=True, text=True, timeout=300)
    ln = next((l for l in (p.stdout or "").splitlines() if l.startswith("PB ")), "")
    return ln[3:].strip() if ln else None

def _inprocess_protobuf():
    """What THIS interpreter sees, which may not be what pip just installed."""
    try:
        import google.protobuf as g
        return g.__version__, getattr(g, "__file__", "?")
    except Exception as e:
        return None, repr(e)[:200]

_pb_sub = _protobuf_version()
_pb_ip, _pb_file = _inprocess_protobuf()
diag("protobuf_before", ok=bool(_pb_sub), subprocess=_pb_sub,
     in_process=_pb_ip, in_process_file=_pb_file)

# The subtlety that broke v17 and v19. `pip install protobuf>=7` DOES land 7.36.2
# on disk - the subprocess probe proves it, and reported pb=7.36.2 - but THIS
# kernel process had already imported protobuf 5.29.5 before the install (the
# runner's own stack pulls it in at startup), so `import google.protobuf` keeps
# handing back the cached 5.x module. vLLM then loads a descriptor generated by
# 7.36.2 and protobuf rejects the pair:
#   VersionError: ... gencode 7.36.2 runtime 5.29.5
#
# Installing the right version was never the problem; the stale module cache
# was. Drop the cached protobuf (and the google namespace above it) so the next
# import reads the installed package.
if _pb_sub and _pb_ip and _pb_ip.split(".")[0] != _pb_sub.split(".")[0]:
    dropped = [m for m in list(sys.modules)
               if m == "google" or m.startswith("google.protobuf")]
    for m in dropped:
        del sys.modules[m]
    importlib.invalidate_caches()
    diag("protobuf_cache_purged", ok=True, dropped=len(dropped),
         was=_pb_ip, now_expected=_pb_sub)
    _pb_ip2, _pb_file2 = _inprocess_protobuf()
    diag("protobuf_after_purge", ok=(_pb_ip2 == _pb_sub),
         in_process=_pb_ip2, in_process_file=_pb_file2)
    if _pb_ip2 != _pb_sub:
        diag("protobuf_still_stale", ok=False, in_process=_pb_ip2,
             file=_pb_file2, note="a different protobuf is winning on sys.path")

# Verify the REAL entry point in a subprocess first, so a failure arrives as a
# readable message rather than an exception from inside this cell.
_vcheck = subprocess.run(
    [sys.executable, "-c",
     "from vllm import LLM, SamplingParams;"
     "from vllm.lora.request import LoRARequest;"
     "from vllm.inputs import TokensPrompt;"
     "import vllm, google.protobuf as g;"
     "print('VC ' + vllm.__version__ + ' pb=' + g.__version__)"],
    capture_output=True, text=True, timeout=900)
_ln = next((l for l in (_vcheck.stdout or "").splitlines() if l.startswith("VC ")), "")
diag("vllm_entrypoint_import", ok=(_vcheck.returncode == 0 and bool(_ln)),
     rc=_vcheck.returncode, line=_ln,
     stderr=(_vcheck.stderr or "")[-700:] if _vcheck.returncode else None)
if _vcheck.returncode != 0:
    raise RuntimeError("vllm entry point still fails in a fresh interpreter: "
                       + (_vcheck.stderr or "")[-700:])

# Step 3: only now is it safe to import in this process.
_STATE = json.loads(INSTALL_MARKER.read_text(encoding="utf-8"))
import vllm
from vllm import LLM, SamplingParams
from vllm.inputs import TokensPrompt
from vllm.lora.request import LoRARequest
import torch as _torch_after
diag("vllm_imports", ok=True, vllm=vllm.__version__,
     torch=_torch_after.__version__, cuda=_torch_after.version.cuda,
     protobuf=_protobuf_version(), gemma4_archs=_STATE.get("gemma4"),
     note="torch here must be the post-install 2.13.0, not the runner 2.10.0")
'''

CODE_FETCH = '''BASE = "google/gemma-4-31b-it-qat-w4a16-ct"   # what the harness serves
HF_REPO = "karthik-a/sparkflashxgemma4"
COMP = "gemma-4-developer-agent"

from huggingface_hub import snapshot_download, hf_hub_download

t0 = time.time()
model_path = pathlib.Path(snapshot_download(BASE, max_workers=8))
diag("model_download", ok=True, repo=BASE, seconds=round(time.time() - t0),
     path=str(model_path))

# Each adapter is its own directory, because that is what LoRARequest wants.
def fetch_adapter(sub):
    d = pathlib.Path(snapshot_download(HF_REPO, allow_patterns=[f"{sub}/*"],
                                       repo_type="model", max_workers=4))
    d = next(d.rglob(sub))
    cfg = json.loads((d / "adapter_config.json").read_text())
    size = (d / "adapter_model.safetensors").stat().st_size
    return d, cfg, size

main_dir, main_cfg, main_bytes = fetch_adapter("main_lora")
tool_dir, tool_cfg, tool_bytes = fetch_adapter("tool_lora")
diag("adapters", ok=True,
     main={"r": main_cfg["r"], "alpha": main_cfg["lora_alpha"],
           "targets": main_cfg["target_modules"], "MB": round(main_bytes / 2**20, 1)},
     tool={"r": tool_cfg["r"], "alpha": tool_cfg["lora_alpha"],
           "targets": tool_cfg["target_modules"], "MB": round(tool_bytes / 2**20, 1)},
     base_in_cfg=main_cfg.get("base_model_name_or_path"))

tasks_path = None
try:
    cd = pathlib.Path(kagglehub.competition_download(COMP, path="tasks.jsonl"))
    tasks_path = next(cd.rglob("tasks.jsonl"))
    print("tasks via kagglehub:", tasks_path)
except Exception as e:
    print("kagglehub competition_download failed:", repr(e)[:120])
if tasks_path is None:
    DATA = WORK / "data"; DATA.mkdir(parents=True, exist_ok=True)
    rc = run(f"kaggle competitions download -c {COMP} -f tasks.jsonl -p {DATA}")
    cand = list(DATA.rglob("tasks.jsonl"))
    if not cand:
        raise RuntimeError(
            f"could not obtain tasks.jsonl for competition {COMP!r} "
            f"(kaggle competitions download rc={rc}). Accept the competition "
            f"rules in the Kaggle UI, or attach it as a kernel data source.")
    tasks_path = cand[0]
tasks = [json.loads(l) for l in tasks_path.read_text(encoding="utf-8").splitlines() if l.strip()]
diag("tasks_loaded", ok=True, n=len(tasks), path=str(tasks_path))
'''

CODE_PROMPTS = '''from transformers import AutoProcessor

# T4 is compute 7.5: no bfloat16 tensor cores, so the activations are fp16.
DTYPE = "float16"
MAX_LEN = 16384          # the official gemma-4-31B-it recipe uses 16384
MAX_RANK = 16            # main_lora is r=16, the larger of the two

processor = AutoProcessor.from_pretrained(str(model_path))
tok = getattr(processor, "tokenizer", processor)

# Identical to training. Do not "improve" these strings: an A/B is only
# meaningful if both arms see the same prompt, and the adapter was trained on
# exactly this wording.
SYSTEM_MAIN = (
    "You are SparkFlashXGamma4, an autonomous coding agent. You map the code graph and "
    "think step-by-step before acting. You reason briefly, then act. You never guess file "
    "contents: you locate the code first, make the smallest change that fixes the reported "
    "problem, verify it, and finish by calling submit_patch with a unified diff."
)
SYSTEM_TOOL = (
    "You are SparkFlashXGamma4 CodeAnalyzer, a read-only explorer. You locate code for "
    "another agent. You never write files, never emit patches, and never propose changes. "
    "You report which files and symbols matter, with line ranges and why."
)

def render_user(task):
    repo = str(task.get("repo") or task.get("repo_name") or task.get("instance_id") or "")
    problem = str(task.get("problem_statement") or task.get("issue") or "").strip()
    hints = str(task.get("hints_text") or "").strip()
    parts = ([f"Repository: {repo}"] if repo else []) + ["", problem]
    if hints:
        parts += ["", "Hints:", hints[:1200]]
    return "\\n".join(parts).strip()

def tool_prompt(task):
    return ("Find the code that must change for this task. Do not propose a patch.\\n\\n"
            + render_user(task))

def build(system, user):
    return processor.apply_chat_template(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        tokenize=False, add_generation_prompt=True, enable_thinking=True)

def to_ids(prompt):
    """Pre-tokenise exactly as training did.

    vLLM's generate() tokenises a string prompt itself and will add a BOS; the
    chat template already emitted one, so a second would shift the whole
    context. Handing vLLM token ids removes the question entirely.
    """
    return tok(prompt, add_special_tokens=False)["input_ids"]

diag("prompts", ok=True, tokenizer=type(tok).__name__,
     vocab=len(tok), enable_thinking_supported=True)
'''

CODE_TASKS = '''# Mid-difficulty selection, unchanged from the original notebook. The easiest
# tasks (1-3 line patches) flatter any adapter: almost any output format scores
# well, so the band is 6..60 changed lines, one task per repo where possible.
def changed_lines(p):
    return sum(1 for l in str(p or "").splitlines()
               if l[:1] in "+-" and not l.startswith(("+++", "---")))

def files_in(p):
    return [l[6:] for l in str(p or "").splitlines() if l.startswith("--- a/")]

scored = [(changed_lines(t.get("patch")), t) for t in tasks]
mid = [(n, t) for n, t in scored if 6 <= n <= 60]
mid.sort(key=lambda x: x[0])
print(f"dev tasks by gold-patch size: min={scored[0][0]} "
      f"median={scored[len(scored) // 2][0]} max={scored[-1][0]}")
print(f"mid-difficulty band 6..60 changed lines: {len(mid)} tasks")

picked, seen = [], set()
for n, t in sorted(mid, key=lambda x: abs(x[0] - 20)):
    repo = str(t.get("repo", ""))
    if repo in seen:
        continue
    seen.add(repo)
    picked.append((n, t))
    if len(picked) == 4:
        break

DEMO = [t for _, t in picked]
for i, t in enumerate(DEMO):
    print(f"\\n[task {i}] {t.get('repo')}  instance={t.get('instance_id')}")
    print(f"  gold patch : {changed_lines(t.get('patch'))} changed lines")
    print(f"  gold files : {files_in(t.get('patch'))[:4]}")

if not DEMO:
    raise RuntimeError(f"no task fell in the 6..60 band out of {len(tasks)} dev tasks")
diag("task_selection", ok=True, n=len(DEMO),
     repos=[t.get("repo") for t in DEMO],
     gold_lines=[changed_lines(t.get("patch")) for t in DEMO])
'''

CODE_ENGINE = '''# First import of torch in this process, and it must be the torch vLLM installed:
# the runner shipped 2.10.0+cu128 and the vllm install replaced it with 2.13.0.
import torch
diag("torch_at_engine", ok=True, torch=torch.__version__, cuda=torch.version.cuda,
     note="must be the post-install torch, not the runner's 2.10.0+cu128")

# vLLM reads the compressed-tensors int4 config straight from the checkpoint,
# so the QAT weights land on the GPU already quantised - which is the step the
# transformers + bitsandbytes path was silently not doing.
t0 = time.time()
llm = LLM(
    model=str(model_path),
    tokenizer=str(model_path),
    dtype=DTYPE,
    tensor_parallel_size=torch.cuda.device_count(),
    gpu_memory_utilization=0.90,
    max_model_len=MAX_LEN,
    enable_lora=True,
    max_lora_rank=MAX_RANK,
    max_loras=1,
    enforce_eager=True,      # skip CUDA-graph capture: this is a short test
    trust_remote_code=False,
    seed=1234,
)
diag("engine", ok=True, seconds=round(time.time() - t0),
     tp=torch.cuda.device_count(), dtype=DTYPE, max_model_len=MAX_LEN,
     gpu_mem_util=0.90, enable_lora=True, max_lora_rank=MAX_RANK)

MAIN_LORA = LoRARequest("main_lora", 1, str(main_dir))
TOOL_LORA = LoRARequest("tool_lora", 2, str(tool_dir))

def gen(system, user, lora=None, max_tokens=600, temperature=0.2, seed=1234):
    """One turn. Same seed for every arm, so the only variable is the adapter."""
    ids = to_ids(build(system, user))
    sp = SamplingParams(temperature=temperature, top_p=1.0,
                        max_tokens=max_tokens, seed=seed)
    t = time.time()
    outs = llm.generate([TokensPrompt(prompt_token_ids=ids)], sp, lora_request=lora)
    dt = time.time() - t
    o = outs[0]
    n_new = len(o.outputs[0].token_ids)
    return o.outputs[0].text, n_new, dt

def show(tag, text, n_new, dt, limit=2000):
    print("\\n" + "=" * 78)
    print(f"{tag}   |  {n_new} new tokens in {dt:.1f}s  ({n_new / max(dt, 1e-6):.2f} tok/s)")
    print("=" * 78)
    print(text[:limit])
    print("-" * 78)

diag("lora_ready", ok=True, main=str(main_dir), tool=str(tool_dir))
'''

MD_TURN1 = """## Turn 1 - base model vs base + main_lora

Identical prompt, temperature 0.2, same seed, same pre-tokenised ids. The only
difference is the adapter. We are looking for: does the adapter emit a parseable
diff in the right shape, and does it point LOCATE at the file the gold patch
actually touches?"""

CODE_TURN1 = '''TASKS = DEMO
base_stats, adapter_stats, transcript = [], [], {}

for i, t in enumerate(TASKS):
    print("\\n\\n" + "#" * 78)
    print(f"# TASK {i}: {t.get('instance_id')}")
    print("#" * 78)
    print(render_user(t)[:1000])
    gold = files_in(t.get("patch"))
    print(f"\\nGOLD (for comparison, not shown to the model):")
    print(f"  files  : {gold}")
    print(f"  patch  : {changed_lines(t.get('patch'))} changed lines")

    r, n, dt = gen(SYSTEM_MAIN, render_user(t), lora=None)
    show(f"[{i} BASE ]", r, n, dt)
    base_stats.append({"new_tokens": n, "seconds": round(dt, 1)})
    transcript[f"{i}_base"] = r

diag("turn1_base", ok=True, n=len(TASKS))
'''

MD_TURN1B = """### Same tasks, `main_lora` attached

`max_lora_rank=16` matches `main_lora`'s r=16. vLLM applies the adapter to the
packed `qkv_proj` / `gate_up_proj` projections from `packed_modules_mapping`,
which is why the adapter's q/k/v and gate/up target names still line up."""

CODE_TURN1B = '''for i, t in enumerate(TASKS):
    print("\\n\\n" + "#" * 78)
    print(f"# TASK {i}  (same prompt, same seed, main_lora attached)")
    print("#" * 78)
    gold = files_in(t.get("patch"))
    print(f"  gold files : {gold}")
    r, n, dt = gen(SYSTEM_MAIN, render_user(t), lora=MAIN_LORA)
    show(f"[{i} ADAPT]", r, n, dt)
    adapter_stats.append({"new_tokens": n, "seconds": round(dt, 1)})
    transcript[f"{i}_adapter"] = r

diag("turn1_adapter", ok=True, n=len(TASKS))
'''

MD_TURN2 = """## Turn 2 - multi-turn follow-up, adapter only

A coding agent gets talked to. If the adapter only helps on turn 1 and then
collapses, that is a real finding."""

CODE_TURN2 = '''FOLLOWUPS = {
    "main": "Before I apply that: which exact lines change, and how do I verify "
            "the fix without breaking the existing tests?",
    "tool": "Which of those files should I open first, and why that one?",
}

def gen_multi(system, turns, lora=None, max_tokens=400, temperature=0.2, seed=1234):
    """Full multi-turn conversation through the model's own template.

    The assistant turns we already generated are fed back as real history, so
    turn 2 sees what turn 1 actually said rather than an idealised version.
    """
    history = [{"role": "system", "content": system}]
    replies = []
    for user in turns:
        history.append({"role": "user", "content": user})
        ids = to_ids(processor.apply_chat_template(
            history, tokenize=False, add_generation_prompt=True, enable_thinking=True))
        sp = SamplingParams(temperature=temperature, top_p=1.0,
                            max_tokens=max_tokens, seed=seed)
        outs = llm.generate([TokensPrompt(prompt_token_ids=ids)], sp, lora_request=lora)
        reply = outs[0].outputs[0].text
        replies.append(reply)
        history.append({"role": "assistant", "content": reply})
    return replies

follow = []
for i, t in enumerate(TASKS[:2]):
    print("\\n\\n" + "#" * 78)
    print(f"# TASK {i} TURN 2 (multi-turn, main_lora only)")
    print("#" * 78)
    reps = gen_multi(SYSTEM_MAIN, [render_user(t), FOLLOWUPS["main"]], lora=MAIN_LORA)
    print(f"USER: {FOLLOWUPS['main']}")
    print(f"ASSISTANT:\\n{reps[-1][:2000]}")
    follow.append(reps)

transcript["followups"] = follow
diag("turn2", ok=True, n=len(follow))
'''

MD_TURN3 = """## Turn 3 - tool_lora: localization, never a patch

`tool_lora` should report files and symbols, not try to edit anything. Scored
against the gold patch's files, so the number below is a measurement and not an
impression."""

CODE_TURN3 = '''tool_report = {}
for i, t in enumerate(TASKS[:2]):
    print("\\n\\n" + "#" * 78)
    print(f"# TASK {i} - tool_lora localization")
    print("#" * 78)
    r, n, dt = gen(SYSTEM_TOOL, tool_prompt(t), lora=TOOL_LORA, max_tokens=400)
    show(f"[{i} TOOL ]", r, n, dt)
    gold = files_in(t.get("patch"))
    hits = [f for f in gold if f in r]
    tool_report[f"{i}_tool"] = {"reply": r, "gold_files": gold, "hits": hits,
                                "gold_basenames": [f.rsplit("/", 1)[-1] for f in gold],
                                "basename_hits": [f for f in gold
                                                  if f.rsplit("/", 1)[-1] in r]}
    print(f"\\nGOLD files  : {gold}")
    print(f"PATH hits   : {hits}  ({len(hits)}/{len(gold)})")
    print(f"BASENAME hit: {tool_report[f'{i}_tool']['basename_hits']}")

diag("turn3", ok=True, n=len(tool_report),
     path_hits={k: f"{len(v['hits'])}/{len(v['gold_files'])}"
                for k, v in tool_report.items()},
     basename_hits={k: f"{len(v['basename_hits'])}/{len(v['gold_files'])}"
                    for k, v in tool_report.items()})
'''

CODE_SUMMARY = '''def fmt_diff(text):
    return "```diff" in text

def locates_gold(text, gold):
    return [f for f in gold if f in text]

summary = {
    "base": {"gen_stats": base_stats,
             "emitted_diff_block": [fmt_diff(transcript[f"{i}_base"])
                                    for i in range(len(TASKS))]},
    "adapter": {"gen_stats": adapter_stats,
                "emitted_diff_block": [fmt_diff(transcript[f"{i}_adapter"])
                                       for i in range(len(TASKS))]},
    "adapter_locates_gold_file": {
        f"{i}": locates_gold(transcript[f"{i}_adapter"], files_in(t.get("patch")))
        for i, t in enumerate(TASKS)},
    "tool_lora_file_hits": {k: f"{len(v['hits'])}/{len(v['gold_files'])}"
                            for k, v in tool_report.items()},
    "tool_lora_basename_hits": {k: f"{len(v['basename_hits'])}/{len(v['gold_files'])}"
                                for k, v in tool_report.items()},
    "tasks": [t.get("instance_id") for t in TASKS],
    "repos": [t.get("repo") for t in TASKS],
    "base_diff_rate": f"{sum(fmt_diff(transcript[f'{i}_base']) for i in range(len(TASKS)))}/{len(TASKS)}",
    "adapter_diff_rate": f"{sum(fmt_diff(transcript[f'{i}_adapter']) for i in range(len(TASKS)))}/{len(TASKS)}",
}
print("\\n" + json.dumps(summary, indent=1))

(WORK / "chat_transcript.json").write_text(
    json.dumps({"summary": summary, "transcript": transcript,
                "tool": tool_report}, indent=1), encoding="utf-8")
diag("summary", ok=True, adapter_diff_rate=summary["adapter_diff_rate"],
     base_diff_rate=summary["base_diff_rate"],
     tool_lora=summary["tool_lora_file_hits"])
print("\\nwrote", WORK / "chat_transcript.json")
print("wrote", DIAG_PATH)
'''

CELLS = [
    ("markdown", MD_TITLE),
    ("markdown", MD_DIAG),
    ("code", CODE_SETUP),
    ("code", CODE_INSTALL),
    ("markdown", "## Repair protobuf, then fetch the checkpoint, adapters and tasks"),
    ("code", CODE_FETCH),
    ("markdown", "## Prompts, rendered exactly as in training"),
    ("code", CODE_PROMPTS),
    ("markdown", "## Mid-difficulty task selection"),
    ("code", CODE_TASKS),
    ("markdown", "## Serve the base checkpoint on vLLM, LoRA enabled"),
    ("code", CODE_ENGINE),
    ("markdown", MD_TURN1),
    ("code", CODE_TURN1),
    ("code", CODE_TURN1B),
    ("markdown", MD_TURN2),
    ("code", CODE_TURN2),
    ("markdown", MD_TURN3),
    ("code", CODE_TURN3),
    ("markdown", "## Summary"),
    ("code", CODE_SUMMARY),
]
