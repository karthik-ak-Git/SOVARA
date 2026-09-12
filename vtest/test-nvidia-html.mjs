import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const MODEL_PATH = `C:\\Users\\Atina\\.lmstudio\\models\\lmstudio-community\\NVIDIA-Nemotron-3-Nano-4B-GGUF\\NVIDIA-Nemotron-3-Nano-4B-Q4_K_M.gguf`;
console.log(`[test] model exists: ${fs.existsSync(MODEL_PATH)} size=${(fs.statSync(MODEL_PATH).size/1024/1024).toFixed(1)} MB`);
console.log(`[test] importing node-llama-cpp...`);
const {getLlama} = await import('node-llama-cpp');
console.log(`[test] getLlama imported`);

let llama;
try {
  console.log(`[test] trying gpu=cuda...`);
  llama = await getLlama({gpu: 'cuda'});
  console.log(`[test] llama gpu=cuda ok: ${llama.gpu}`);
} catch(e) {
  console.error(`[test] cuda failed: ${e.message.slice(0,300)}`);
  console.log(`[test] trying gpu=vulkan...`);
  try { llama = await getLlama({gpu: 'vulkan'}); console.log(`[test] vulkan ok: ${llama.gpu}`); }
  catch(e2){ console.error(`[test] vulkan failed: ${e2.message}`); console.log(`[test] trying cpu...`); llama = await getLlama({gpu: false}); console.log(`[test] cpu ok`); }
}
if(!llama){ llama = await getLlama({gpu: false}); }
console.log(`[test] llama gpu final: ${llama.gpu}`);
console.log(`[test] loading model...`);
const model = await llama.loadModel({modelPath: MODEL_PATH, useMmap: true});
console.log(`[test] model loaded: ${model.size} fallback`);
const threads = Math.max(1, os.cpus().length - 2);
console.log(`[test] creating context threads=${threads} ctx=4096 flashAttention`);
const context = await model.createContext({contextSize: 4096, threads, flashAttention: true});
const sequence = context.getSequence();
console.log(`[test] context ready, generating html page...`);
import {LlamaChatSession} from 'node-llama-cpp';
const session = new LlamaChatSession({contextSequence: sequence, systemPrompt: 'You are a helpful assistant. Generate clean HTML.'});
const prompt = `Generate a complete single-file HTML page for a personal portfolio. Features: modern dark theme, hero with name Alex Rivera, skills grid, projects cards, contact form. Use inline CSS, no external dependencies. Output ONLY the HTML, starting with <!DOCTYPE html> and ending with </html>. Make it visually polished.`;
console.log(`[test] prompt len ${prompt.length}`);
let html = '';
const start = Date.now();
for await (const chunk of session.prompt(prompt, {maxTokens: 2048, temperature: 0.7})) {
  html += chunk;
  process.stdout.write(chunk);
}
const elapsed = ((Date.now()-start)/1000).toFixed(1);
console.log(`\n[test] done elapsed ${elapsed}s len=${html.length}`);
const outPath = `C:\\Users\\Atina\\AppData\\Local\\Temp\\opencode\\nvidia-generated.html`;
fs.writeFileSync(outPath, html, 'utf8');
console.log(`[test] wrote ${outPath}`);
console.log(`[test] html valid start: ${html.slice(0,200)}`);
