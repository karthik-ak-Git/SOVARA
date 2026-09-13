import type { SessionEventView } from '@shared/types/ports'

function tfidfScore(query:string, doc:string):number {
  const qTokens = query.toLowerCase().split(/\W+/).filter(Boolean)
  const d = doc.toLowerCase()
  let score=0
  for(const t of qTokens){
    const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'g')
    const m = d.match(re)
    if(m) score += m.length * (1 + Math.log(1 + t.length))
  }
  // recency boost handled by caller
  return score
}

export interface RagOpts { maxChunks?:number; maxChars?:number }

export function toDocText(e:SessionEventView):string|null {
  if(e.type!=='user/message' && e.type!=='assistant/message') return null
  const c = typeof e.data==='string' ? e.data : (e.data as Record<string,unknown>)?.['content']
  return typeof c==='string' && c.trim() ? c.trim() : null
}

export function retrieveRelevant(events:SessionEventView[], query:string, opts?:RagOpts): SessionEventView[] {
  const maxChunks = opts?.maxChunks ?? 6
  const maxChars = opts?.maxChars ?? 12000
  const docs = events.map((e,i)=>({e, text: toDocText(e), idx:i})).filter(x=>x.text) as Array<{e:SessionEventView;text:string;idx:number}>
  if(docs.length===0) return []
  // always keep last assistant/user pair for continuity if recent
  const scored = docs.map(d=>({ ...d, score: tfidfScore(query, d.text!) + (d.idx/docs.length)*0.5 }))
  scored.sort((a,b)=> b.score - a.score)
  const picked = scored.slice(0, maxChunks).sort((a,b)=> a.idx - b.idx)
  let chars=0
  const out:SessionEventView[]=[]
  for(const p of picked){
    const len = p.text!.length
    if(chars+len > maxChars && out.length>0) break
    out.push(p.e); chars+=len
  }
  return out
}

// Optional embedding hook: if an embedding fn is provided, use cosine instead of tfidf (future: call local embedding model)
export async function retrieveWithEmbeddings(
  events:SessionEventView[], query:string,
  embed:(text:string)=>Promise<number[]>,
  opts?:RagOpts
): Promise<SessionEventView[]> {
  const docs = events.map(e=>({e, text: toDocText(e)})).filter(x=>x.text) as Array<{e:SessionEventView;text:string}>
  if(docs.length===0) return []
  const qEmb = await embed(query)
  const cos = (a:number[],b:number[])=> {
    let dot=0, na=0, nb=0
    for(let i=0;i<Math.min(a.length,b.length);i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i] }
    return dot/(Math.sqrt(na)*Math.sqrt(nb)+1e-9)
  }
  const q = await Promise.all(docs.map(async d=>({d, score: cos(qEmb, await embed(d.text!))})))
  q.sort((a,b)=> b.score - a.score)
  return q.slice(0, opts?.maxChunks ?? 6).sort((a,b)=> events.indexOf(a.d.e)-events.indexOf(b.d.e)).map(x=>x.d.e)
}
