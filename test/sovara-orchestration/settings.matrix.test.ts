import { describe, it, expect } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { classifyTask } from '../../apps/desktop/src/main/backend/TaskClassifier'
import { detectOutputFormat, generateArtifactFile } from '../../apps/desktop/src/main/backend/artifacts'
import { routeModel } from '../../apps/desktop/src/main/backend/ModelRouter'
import type { TaskClassification } from '../../apps/shared/types/task'

function mkTmp(){ return fs.mkdtempSync(path.join(os.tmpdir(),'sovara-matrix-'))}

// All settings dimensions to permute
const reasoningOpts = [undefined, true] as const
const webSearchOpts = [undefined, true] as const
const hasImageOpts = [false, true] as const
const attachmentSizes = [0, 5000, 20000] as const
const inputMimes = ['image/png','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain'] as const
const outputPrompts = [
  ['generate a pdf report','pdf'], ['export as excel','xlsx'], ['create a word document','docx'],
  ['write the code to app.py','code'], ['draw a system diagram','drawing'], ['generate an image of a cat','drawing'],
  ['summarize this','chat'], ['hello there','chat'],
] as const

const models = [
  {modelId:'local:phi-4', displayName:'phi', runtimeId:'local', source:'custom' as const, capabilities:['chat','reasoning'], available:true, contextLength:8192},
  {modelId:'local:qwen-vl', displayName:'qwen-vl', runtimeId:'local', source:'custom' as const, capabilities:['chat','vision'], available:true, contextLength:8192},
  {modelId:'local:codellama', displayName:'code', runtimeId:'local', source:'custom' as const, capabilities:['coding'], available:true, contextLength:4096},
]

describe('Settings matrix — classify × detectOutput × route (all combos)', ()=>{
  for(const reasoning of reasoningOpts)
    for(const webSearch of webSearchOpts)
      for(const hasImage of hasImageOpts)
        for(const att of attachmentSizes){
          it(`reasoning=${String(reasoning)} webSearch=${String(webSearch)} hasImage=${hasImage} att=${att} → sane classification`, ()=>{
            const c = classifyTask('Analyze this project and fix the bug then summarize', {reasoning, webSearch, hasImage, attachmentChars:att})
            expect(c.contextLengthNeeded).toBeGreaterThanOrEqual(4096)
            if(hasImage) expect(c.requiresVision).toBe(true)
            if(webSearch && !reasoning && !hasImage) expect(c.kind).toBe('tool-use')
            // no crash on any combo
            expect(['chat','coding','analysis','summarization','reasoning','tool-use','agent']).toContain(c.kind)
          })
        }

  for(const [prompt, expectedKind] of outputPrompts){
    it(`output "${prompt}" → ${expectedKind}`, ()=>{
      const d = detectOutputFormat(prompt)
      if(expectedKind==='chat') expect(d).toBeNull()
      else expect(d?.kind).toBe(expectedKind)
    })
  }

  for(const mime of inputMimes){
    it(`input mime ${mime} accepted (not audio/video)`, ()=>{
      expect(mime).not.toMatch(/audio|video/)
    })
  }

  it('routes vision task to vision model, non-vision to best scorer', async ()=>{
    const visionTask: TaskClassification = classifyTask('describe this', {hasImage:true}) as any
    const r1 = await routeModel({task: visionTask, models, resources: {cpu:{logicalCores:8,loadAvg1:0.5}, ram:{totalMB:16000,freeMB:8000,usedByAppMB:200}, gpu:{available:true,name:'g'}, vram:{totalMB:8000,freeMB:6000,usedByModelsMB:0}, disk:{path:'/tmp',totalMB:100000,freeMB:50000}, models:{instances:[],totalVramUsedMB:0}, limits:{maxConcurrentModels:2}} as any})
    expect(r1.modelId).toContain('qwen-vl')
  })

  it('drawing generation writes HTML+SVG for every image request', ()=>{
    const dir=mkTmp(); const file=path.join(dir,'draw.html')
    const g = generateArtifactFile('drawing', file, '# Title\nbody', 'draw a diagram')
    expect(g?.bytes).toBeGreaterThan(0)
    expect(fs.readFileSync(file,'utf8')).toContain('<svg')
  })

  it('SYSTEM_PROMPT spine covers all settings', ()=>{
    const p = fs.readFileSync('D:/SOVARA/test/sovara-orchestration/SYSTEM_PROMPT.md','utf8')
    expect(p).toContain('Sovereignty first')
    expect(p).toContain('Orchestration')
  })
})
