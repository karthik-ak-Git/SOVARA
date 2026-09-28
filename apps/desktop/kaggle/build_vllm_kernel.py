"""Assemble the vLLM-based kernel notebook and validate it before pushing.

Two things this guarantees, both of which cost a Kaggle run to learn the hard
way on the previous seven versions:
  * every code cell is valid Python after the diagnostic wrapping (ast.parse)
  * no diagnostic import of vllm/transformers happens before the install cell,
    which is what left v6 and v7 installing the right versions into a process
    still holding the runner's old modules in sys.modules
"""
import ast
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from vllm_cells import CELLS  # noqa: E402

DST = pathlib.Path(__file__).parent / "sf-gemma4-adapter-test-vllm"
DST.mkdir(parents=True, exist_ok=True)
SLUG = "atinarapukarthik/sf-gemma4-adapter-test"

# The install cell is the one that must run before anything imports vllm.
INSTALL_MARKERS = ("vllm_subprocess_probe", "INSTALL_MARKER")
install_idx = next(
    i for i, (t, s) in enumerate(CELLS)
    if t == "code" and all(m in s for m in INSTALL_MARKERS)
)

# The install cell owns both the vLLM install and the protobuf repair, because
# v17 died in that cell: it imported vllm's entry point before repairing the
# protobuf major mismatch. Locate the fetch cell separately so a reordering
# cannot silently drop the checkpoint download.
FETCH_MARKERS = ("snapshot_download", "fetch_adapter")
fetch_idx = next(
    i for i, (t, s) in enumerate(CELLS)
    if t == "code" and all(m in s for m in FETCH_MARKERS)
)

SETUP_MARKERS = ("def diag(", "DIAG_PATH")
setup_idx = next(
    i for i, (t, s) in enumerate(CELLS)
    if t == "code" and all(m in s for m in SETUP_MARKERS)
)

# vllm and transformers are the two the install cell actually changes, so those
# are the ones that must not be imported early. huggingface_hub and kagglehub
# are untouched by the install and are needed by the fetch cell regardless.
HEAVY = ("import vllm", "from vllm", "import transformers", "from transformers")


def wrap(text, label):
    """Record success and failure per cell.

    sys.excepthook is not enough: ipykernel renders a failing cell's traceback
    itself, so the hook never fires and the run dies with no artefact. A
    per-cell try/except is the only mechanism that reliably observes it.
    """
    lines = text.splitlines(keepends=True)
    body = "".join("    " + ln if ln.strip() else ln for ln in lines)
    return ("try:\n" + body +
            "\nexcept BaseException as _e:\n"
            f"    diag({label!r}, ok=False, error=repr(_e)[:400])\n"
            "    raise\n"
            f"diag({label!r}, ok=True)\n")


cells = []
n_wrap = 0
for i, (ctype, src) in enumerate(CELLS):
    if ctype != "code":
        cells.append({"cell_type": "markdown", "id": f"md-{i:02d}",
                      "metadata": {}, "source": src.splitlines(keepends=True)})
        continue
    if i == setup_idx:
        # Needs no wrapping: it defines diag() for every later cell.
        out = src
    else:
        out = wrap(src, f"cell_{i}")
        n_wrap += 1
    cells.append({"cell_type": "code", "id": f"code-{i:02d}",
                  "execution_count": None, "metadata": {}, "outputs": [],
                  "source": out.splitlines(keepends=True)})

# --- guard 1: nothing heavy is imported before the install cell ---------------
for i, c in enumerate(cells):
    # Only cells BEFORE the install cell are a problem: once it has run, the
    # runner holds the versions the notebook needs. The install cell is exempt
    # too, because trying those imports is how it decides to upgrade.
    if c["cell_type"] != "code" or i >= install_idx:
        continue
    for ln in "".join(c["source"]).splitlines():
        code = ln.split("#", 1)[0]
        if any(code.strip().startswith(h) for h in HEAVY):
            raise SystemExit(
                f"cell {i} imports {code.strip()!r} before the install cell "
                f"({install_idx}); that is what poisoned sys.modules on v6/v7")

# --- guard 2: every code cell parses ----------------------------------------
for i, c in enumerate(cells):
    if c["cell_type"] != "code":
        continue
    src = "".join(c["source"])
    try:
        ast.parse(src)
    except SyntaxError as e:
        raise SystemExit(f"cell {i} is not valid Python: {e}")

# --- guard 3: any embedded source string survives the re-indent --------------
# Wrapping a cell indents every line by 4, which silently breaks a triple-quoted
# literal written flush-left: v16 shipped a _probe.py that died with
# "IndentationError: unexpected indent" before importing anything. Compile each
# embedded literal on its own, after dedenting, so that class of bug cannot ship.
import re as _re
import textwrap as _tw

EMBEDDED = []
for i, c in enumerate(cells):
    if c["cell_type"] != "code":
        continue
    src = "".join(c["source"])
    for m in _re.finditer(r'("""|\'\'\')(?P<body>.*?)\1', src, _re.S):
        body = m.group("body")
        if "PROBE " not in body:
            continue
        lit = _tw.dedent(body).lstrip()
        try:
            ast.parse(lit)
        except SyntaxError as e:
            raise SystemExit(
                f"cell {i} embeds a source literal that breaks when indented by "
                f"the diagnostic wrapper: {e}\n{lit[:200]}")
        EMBEDDED.append((i, lit.splitlines()[0][:60]))

# --- guard 4: dedent the probe ourselves if the cell forgot to --------------
INSTALL_SRC = "".join(cells[install_idx]["source"])
if "textwrap.dedent" not in INSTALL_SRC:
    raise SystemExit("install cell writes a subprocess probe without dedenting it; "
                     "the diagnostic wrapper's indent would break it (v16)")

# v16's bug: the wrapper's 4-space re-indent breaks a flush-left triple-quoted
# literal that is written out as a standalone file.
if '_probe.py' in INSTALL_SRC and "textwrap.dedent" not in INSTALL_SRC:
    raise SystemExit("install cell writes _probe.py without dedenting (v16)")
FETCH_SRC = "".join(cells[fetch_idx]["source"])
INSTALL_SRC2 = "".join(cells[install_idx]["source"])

# v17's exact ordering bug, asserted so it cannot come back: the protobuf repair
# has to precede the in-process `from vllm import LLM`, and it has to live in the
# SAME cell, because the failure happened before the next cell could run.
if "protobuf_cache_purged" not in INSTALL_SRC2:
    raise SystemExit(
        "install cell does not purge the cached protobuf module; v17 and v19 both "
        "died because pip installed 7.36.2 while this process kept the runner's "
        "cached 5.29.5 (gencode 7.36.2 vs runtime 5.29.5)")
if "vllm_entrypoint_import" not in INSTALL_SRC2:
    raise SystemExit("install cell does not verify the vllm entry-point import")
# Anchor on the IN-PROCESS import (column 0), not on any mention: the literal
# text "from vllm import LLM" also appears in a comment and inside the
# subprocess -c probe, both of which legitimately precede the repair.
# The wrapper indents every line by 4, so the in-process import sits at column 4
# in the built notebook, not column 0. Match it as a standalone statement, which
# is what the subprocess -c probe and the comment both fail to be.
_i_pb = INSTALL_SRC2.find("protobuf_cache_purged")
_i_imp = _re.search(r"(?m)^\s*from vllm import LLM, SamplingParams\s*$", INSTALL_SRC2)
if not _i_imp or not (0 <= _i_pb < _i_imp.start()):
    raise SystemExit(
        f"ordering bug: protobuf_upgrade at {_i_pb} but the in-process vllm "
        f"import at {_i_imp.start() if _i_imp else None}; the repair must come "
        f"first (this is how v17 failed)")
if "protobuf_upgrade" in FETCH_SRC:
    raise SystemExit("fetch cell still repairs protobuf; the install cell owns it")
if "snapshot_download" not in FETCH_SRC:
    raise SystemExit("fetch cell lost the checkpoint download")

nb = {
    "cells": cells,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python",
                       "name": "python3"},
        "language_info": {"name": "python", "version": "3.12"},
    },
    "nbformat": 4,
    "nbformat_minor": 5,
}

nb_path = DST / f"{SLUG.split('/')[-1]}.ipynb"
nb_path.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")

(DST / "kernel-metadata.json").write_text(json.dumps({
    "id": SLUG,
    "title": "sf-gemma4-adapter-test",
    "code_file": nb_path.name,
    "language": "python",
    "kernel_type": "notebook",
    "is_private": True,
    "enable_gpu": True,
    "enable_tpu": False,
    "enable_internet": True,
}, indent=1), encoding="utf-8")

n_code = sum(1 for c in cells if c["cell_type"] == "code")
print(f"kernel   : {SLUG}")
print(f"notebook : {nb_path}")
print(f"cells    : {len(cells)} ({n_code} code, {n_wrap} wrapped for diagnostics)")
print(f"order    : setup={setup_idx} install={install_idx} fetch={fetch_idx} "
      f"(nothing heavy imported before install)")
print(f"embedded : {len(EMBEDDED)} subprocess source literal(s) verified after dedent")
for i, head in EMBEDDED:
    print(f"           cell {i}: {head}")
print("guards   : all code cells parse; no pre-install vllm/transformers import; "
      "embedded literals dedent cleanly")
