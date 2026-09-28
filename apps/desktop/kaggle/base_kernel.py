# SparkFlashXGamma4 - Bulletproof Kaggle Training Pipeline
This notebook trains a LoRA adapter on the standard `bnb-4bit` version of Gemma 4 31B to bypass all QAT memory crashes. The resulting `.safetensors` adapter can be natively applied to the `qat-w4a16` model required by the competition.
%%capture
# CELL 1: INSTALL STABLE DEPENDENCIES
!pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
!pip install --no-deps xformers trl peft accelerate bitsandbytes
!pip install triton==3.1.0 pynvml
!pip install -U transformers tokenizers datasets
# CELL 2: AUTHENTICATION
from kaggle_secrets import UserSecretsClient
from huggingface_hub import login

user_secrets = UserSecretsClient()
hf_token = user_secrets.get_secret("HF_TOKEN")
login(hf_token)
print("Successfully logged into Hugging Face.")
# CELL 3: LOAD MODEL (STABLE BNB-4BIT PATH)
from unsloth import FastLanguageModel
import torch

max_seq_length = 4096
dtype = None
load_in_4bit = True # This safely triggers bitsandbytes

print("Loading Gemma-4-31B (BNB 4-bit)... This is highly stable on Kaggle.")

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "unsloth/gemma-4-31b-it-bnb-4bit", # Using BNB instead of QAT for training
    max_seq_length = max_seq_length,
    dtype = dtype,
    load_in_4bit = load_in_4bit,
    device_map = "auto", # Works perfectly with bnb-4bit
    use_gradient_checkpointing = "unsloth",
)

model = FastLanguageModel.get_peft_model(
    model,
    r = 16,
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj",
                      "gate_proj", "up_proj", "down_proj"],
    lora_alpha = 16,
    lora_dropout = 0,
    bias = "none",
    random_state = 3407,
    use_rslora = True,
    loftq_config = None,
)
print("Model loaded and LoRA adapters successfully attached!")
# CELL 4: DATASET FORMATTING (ROBUST PARSING)
from datasets import load_dataset
from unsloth.chat_templates import get_chat_template
import json

tokenizer = get_chat_template(tokenizer, chat_template = "gemma")
dataset = load_dataset("nebius/SWE-agent-trajectories", split="train[:2000]")

def format_prompts(examples):
    formatted_texts = []
    
    for traj_raw in examples['trajectory']:
        if isinstance(traj_raw, list):
            traj_list = traj_raw
        elif isinstance(traj_raw, str):
            try:
                traj_list = json.loads(traj_raw)
            except:
                formatted_texts.append("")
                continue
        else:
            formatted_texts.append("")
            continue
            
        messages = []
        for turn in traj_list:
            original_role = turn.get("role", "")
            if original_role == "system": continue 
            
            role = "assistant" if original_role == "ai" else "user"
            content = str(turn.get("content", ""))
            if role == "user" and len(content) > 1500:
                content = content[:1500] + "\n\n...[Terminal Output Truncated]..."
                
            if messages and messages[-1]["role"] == role:
                messages[-1]["content"] += "\n\n" + content
            else:
                messages.append({"role": role, "content": content})
        
        if messages and messages[0]["role"] == "assistant":
            messages.insert(0, {"role": "user", "content": "You are SparkFlashXGamma4. Initialize debugging task."})
        elif messages:
            messages[0]["content"] = "You are SparkFlashXGamma4. You must map the code graph and think step-by-step before executing any tool.\n\n" + messages[0]["content"]
            
        try:
            text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
        except Exception:
            text = ""
            
        formatted_texts.append(text)
        
    return {"text": formatted_texts}

print("Parsing trajectories...")
dataset = dataset.map(format_prompts, batched=True, num_proc=2)
original_size = len(dataset)
dataset = dataset.filter(lambda x: len(x["text"]) > 10)
print(f"Dataset ready. Kept {len(dataset)} out of {original_size} trajectories.")
# CELL 5: UNSLOTH SFT TRAINING
from trl import SFTTrainer
from transformers import TrainingArguments
from unsloth import is_bfloat16_supported
import torch

trainer = SFTTrainer(
    model = model,
    tokenizer = tokenizer,
    train_dataset = dataset,
    dataset_text_field = "text",
    max_seq_length = max_seq_length,
    dataset_num_proc = 2,
    args = TrainingArguments(
        per_device_train_batch_size = 2,
        gradient_accumulation_steps = 4,
        warmup_steps = 5,
        max_steps = 150,
        learning_rate = 2e-4,
        fp16 = not is_bfloat16_supported(),
        bf16 = is_bfloat16_supported(),
        logging_steps = 1,
        optim = "adamw_8bit",
        weight_decay = 0.01,
        lr_scheduler_type = "linear",
        seed = 3407,
        output_dir = "sparkflash_outputs",
        report_to = "none",
    ),
)

print("Starting Training...")
trainer_stats = trainer.train()
print("Training Complete!")
# CELL 6: EXPORT ADAPTER FOR COMPETITION SUBMISSION
import os

repo_name = "your-hf-username/SparkFlashXGamma4-Adapter"
print(f"Saving LoRA adapters and pushing to {repo_name}...")

# This saves the adapter_config.json and adapter_model.safetensors 
# You will put these exact files into your submission.zip
model.save_pretrained("sparkflash_lora")
tokenizer.save_pretrained("sparkflash_lora")

model.push_to_hub(repo_name, token=hf_token)
print("SUCCESS! Your adapters are saved locally in '/sparkflash_lora' and pushed to Hugging Face.")