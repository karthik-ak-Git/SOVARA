const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');
const CONTEXT_TIERS=[1024,2048,4096,8192,16384,32768];
function pickTier(v,mbPer1k){const max=Math.floor((v/mbPer1k)*1000);const e=CONTEXT_TIERS.filter(t=>t<=max);return e.length?e[e.length-1]:1024;}
async function getFreeVramMb(){return new Promise(r=>exec('nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits',{timeout:5000},(e,s)=>{if(e)return r(0);const v=parseInt(s.trim().split('\n')[0],10);r(isNaN(v)?0:v);}));}
async function detectHardwareProfile(modelSizeMb){
  const freeVram=await getFreeVramMb(); const freeRam=Math.floor(os.freemem()/1048576); const totalRam=Math.floor(os.totalmem()/1048576);
  const usable=freeVram*0.85;
  if(freeVram===0) return {freeVram,freeRam,totalRam,mode:'cpu',gpuLayers:0,contextSize:pickTier(freeRam*0.85,8),warnings:['No GPU']};
  if(modelSizeMb>=usable){const ratio=usable/modelSizeMb;const gpuLayers=Math.max(1,Math.floor(32*ratio));const um=Math.max(usable-gpuLayers*(modelSizeMb/32),256);return {freeVram,freeRam,totalRam,mode:'partial-gpu',gpuLayers,contextSize:pickTier(um,8),warnings:[`Model ${modelSizeMb}MB > VRAM ${freeVram}MB partial ${gpuLayers}`]};}
  const um=Math.max(usable-modelSizeMb,256);let ctx=pickTier(um,8);
  if(totalRam<16000) ctx=Math.min(ctx,131072); if(freeVram<6144) ctx=Math.min(ctx,32768);
  // app location only disk cache
  const cacheDir=path.join(app.getPath('userData'),'disk_kv'); if(!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir,{recursive:true});
  return {freeVram,freeRam,totalRam,mode:'full-gpu',gpuLayers:-1,contextSize:ctx,cacheDir,warnings:[]};
}
let win=null;
function createWindow(){win=new BrowserWindow({width:1200,height:800,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true}});win.loadFile(path.join(__dirname,'index.html'));}
app.whenReady().then(createWindow);
ipcMain.handle('hardware-status-fetch',async(e,a)=>{const p=await detectHardwareProfile(a?.modelSizeMb||4000);return{success:true,profile:p};});
ipcMain.handle('engine-init',async(e,c)=>{const s=fs.statSync(c.modelPath);const mb=Math.floor(s.size/1048576);const p=await detectHardwareProfile(mb);return{success:true,profile:p};});
ipcMain.handle('prompt-submit',async()=>({success:false,error:'use disk_llama_core addon'}));
app.on('window-all-closed',()=>{if(process.platform!=='darwin') app.quit();});
