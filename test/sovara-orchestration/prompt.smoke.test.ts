import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classifyTask } from '../../apps/desktop/src/main/backend/TaskClassifier'
import { detectOutputFormat, generateArtifactFile, extractPdfText, extractDocxText, extractXlsxText, writeXlsxFile } from '../../apps/desktop/src/main/backend/artifacts'
import { createZip } from '../../apps/desktop/src/main/backend/minizip'
import { processAttachments } from '../../apps/desktop/src/main/backend/attachments'
import { AgentOrchestrator } from '../../apps/desktop/src/main/backend/AgentOrchestrator'

function mkTmp(){ return fs.mkdtempSync(path.join(os.tmpdir(),'sovara-prompt-'))}
function dataUrl(m:string,b:Buffer){ return `data:${m};base64,${b.toString('base64')}`}

// Inputs: image, pdf, word, excel — every data instead of audio/video
describe('Sovara prompt — inputs (image/pdf/word/excel, no audio/video)', ()=>{
  it('image attachment → vision capability, not audio/video', ()=>{
    const c = classifyTask('what is in this photo?', {hasImage:true})
    expect(c.requiredCapabilities).toContain('vision')
    expect(c.requiredCapabilities).not.toContain('audio')
    // still chat base, not forced to generation
    expect(detectOutputFormat('what is in this photo?')).toBeNull()
  })
  it('pdf input is read as document context', ()=>{
    const pdf = Buffer.from('%PDF-1.4 ... (Hello PDF) Tj', 'latin1')
    const r = processAttachments([{name:'doc.pdf', mime:'application/pdf', size:pdf.length, data:dataUrl('application/pdf', pdf)}], {sessionId:'sess-1', baseDir:mkTmp(), persist:false})
    expect(r.files[0]?.kind).not.toBe('audio')
  })
  it('word/docx input round-trips', ()=>{
    const buf = createZip([{name:'word/document.xml', data:'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>hello word doc</w:t></w:r></w:p></w:body></w:document>'}])
    const r = processAttachments([{name:'file.docx', mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size:buf.length, data:dataUrl('application/vnd.openxmlformats-officedocument.wordprocessingml.document', buf)}], {sessionId:'sess-1', baseDir:mkTmp(), persist:false})
    expect(r.files[0]?.text).toContain('hello word doc')
  })
  it('excel input round-trips', ()=>{
    const dir=mkTmp(); const file=path.join(dir,'t.xlsx')
    writeXlsxFile(file, [{name:'Sheet1', rows:[['a','b'],['1','2']]}])
    const buf=fs.readFileSync(file)
    const r = processAttachments([{name:'t.xlsx', mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size:buf.length, data:dataUrl('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf)}], {sessionId:'sess-1', baseDir:mkTmp(), persist:false})
    expect(r.files[0]?.text).toContain('a')
  })
})

// Generation: every data instead of audio/video, image → drawing
describe('Sovara prompt — generation (pdf/word/excel/code/drawing, no audio/video)', ()=>{
  const cases: Array<[string,string]> = [
    ['generate a pdf report of sales', 'pdf'],
    ['export this as excel please', 'xlsx'],
    ['create a word document from this', 'docx'],
    ['write the code to app.py', 'code'],
    ['draw a diagram of the system', 'drawing'],
    ['generate an image of a cat', 'drawing'],
    ['create a drawing for the architecture', 'drawing'],
  ]
  for(const [prompt, kind] of cases){
    it(`"${prompt}" → ${kind}`, ()=> expect(detectOutputFormat(prompt)?.kind).toBe(kind))
  }
  it('drawing artifact generates HTML+SVG', ()=>{
    const dir=mkTmp(); const file=path.join(dir,'out.html')
    const g = generateArtifactFile('drawing', file, 'A system with 3 boxes connected', 'draw a diagram of the system')
    expect(g).not.toBeNull()
    const html=fs.readFileSync(file,'utf8')
    expect(html).toContain('<svg')
    expect(html).toContain('draw a diagram')
  })
  it('audio/video generation is NOT triggered (out of scope)', ()=>{
    expect(detectOutputFormat('generate audio of this text')).toBeNull()
    expect(detectOutputFormat('generate video of this')).toBeNull()
  })
})

// System prompt sanity
describe('SYSTEM_PROMPT.md structure', ()=>{
  it('contains all spine sections', ()=>{
    const p = fs.readFileSync(path.resolve(__dirname,'../../../test/sovara-orchestration/SYSTEM_PROMPT.md'),'utf8')
    for(const h of ['Prime directives','System','Workspace','Doing tasks','Execution with care','Orchestration','Memory','Skills']) expect(p).toContain(h)
  })
})
