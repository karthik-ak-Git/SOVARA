"""Decide whether the adapter-load line in the Kaggle kernel actually resolves.

The kernel does:

    adapter_dir = Path(hf_hub_download(HF_REPO, "main_lora/adapter_model.safetensors",
                                       repo_type="model"))
    model = PeftModel.from_pretrained(base_model, str(adapter_dir.parent),
                                      subfolder="main_lora", is_trainable=False)

`adapter_dir` is the *file* .../main_lora/adapter_model.safetensors, so
`adapter_dir.parent` is the *directory* .../main_lora. Passing subfolder="main_lora"
on top of that asks PEFT for .../main_lora/main_lora. Reproduce both layouts with
the real published config and see which one resolves.
"""
import json, pathlib, shutil, sys, tempfile
import peft
from peft import PeftConfig
from peft.utils.save_and_load import load_peft_weights

print("peft", peft.__version__)

REAL_CFG = {
    "peft_type": "LORA", "task_type": "CAUSAL_LM",
    "base_model_name_or_path": "google/gemma-4-31b-it-qat-w4a16-ct",
    "r": 16, "lora_alpha": 32, "lora_dropout": 0.05,
    "use_rslora": True, "use_dora": False, "bias": "none",
    "target_modules": ["down_proj", "gate_proj", "k_proj", "o_proj",
                       "q_proj", "up_proj", "v_proj"],
    "fan_in_fan_out": False, "inference_mode": True, "modules_to_save": None,
    "init_lora_weights": True, "rank_pattern": {}, "alpha_pattern": {},
    "revision": None, "layers_to_transform": None, "layers_pattern": None,
    "loftq_config": {}, "lora_bias": False,
}

root = pathlib.Path(tempfile.mkdtemp(prefix="loraprobe_"))
(root / "main_lora").mkdir(parents=True)
(root / "main_lora" / "adapter_config.json").write_text(json.dumps(REAL_CFG), encoding="utf-8")
# A real but tiny weight file so load_peft_weights has something to open.
from safetensors.torch import save_file
import torch
save_file({"lora_A.default.weight": torch.zeros(4, 8)},
          str(root / "main_lora" / "adapter_model.safetensors"))

# Mirror hf_hub_download's cache layout, then reproduce the kernel's exact args.
adapter_dir = root / "main_lora" / "adapter_model.safetensors"
kernel_model_id = str(adapter_dir.parent)   # -> <root>/main_lora
print(f"kernel passes model_id = {kernel_model_id!r}, subfolder = 'main_lora'")
print(f"that resolves to        = {kernel_model_id}/main_lora  -> exists? "
      f"{(root / 'main_lora' / 'main_lora').exists()}")

def try_cfg(label, model_id, subfolder):
    try:
        c = PeftConfig.from_pretrained(model_id, subfolder=subfolder) if subfolder \
            else PeftConfig.from_pretrained(model_id)
        print(f"  PASS  {label}: r={c.r} alpha={c.lora_alpha}")
        return c
    except Exception as e:
        print(f"  FAIL  {label}: {type(e).__name__}: {str(e)[:150]}")
        return None

def try_w(label, model_id, subfolder):
    try:
        w = load_peft_weights(model_id, subfolder=subfolder) if subfolder \
            else load_peft_weights(model_id)
        n = len(w) if hasattr(w, "__len__") else "?"
        print(f"  PASS  {label}: loaded {n} tensors")
        return w
    except Exception as e:
        print(f"  FAIL  {label}: {type(e).__name__}: {str(e)[:150]}")
        return None

print("\n[1] exactly what the kernel does today")
a = try_cfg("PeftConfig  subfolder='main_lora'", kernel_model_id, "main_lora")
b = try_w("load_peft_weights subfolder='main_lora'", kernel_model_id, "main_lora")

print("\n[2] drop subfolder (adapter dir is already the adapter dir)")
c = try_cfg("PeftConfig  subfolder=None", kernel_model_id, None)
d = try_w("load_peft_weights subfolder=None", kernel_model_id, None)

print("\n[3] point at the repo root and keep subfolder")
e = try_cfg("PeftConfig  subfolder='main_lora'", str(root), "main_lora")
f = try_w("load_peft_weights subfolder='main_lora'", str(root), "main_lora")

print("\nVERDICT:")
if a is None and c is not None:
    print("  kernel's current call is BROKEN for a local path; the one-line fix is")
    print("  to drop subfolder (adapter_dir.parent is already .../main_lora),")
    print("  or pass the repo root and keep subfolder='main_lora'.")
elif a is not None:
    print("  kernel's current call resolves; no change needed.")
else:
    print("  INCONCLUSIVE - inspect above.")

shutil.rmtree(root, ignore_errors=True)
