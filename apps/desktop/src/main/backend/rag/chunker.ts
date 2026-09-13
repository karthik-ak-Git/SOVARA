export interface Chunk { index:number; text:string; start:number; end:number; }

export function chunkText(text:string, opts?:{ chunkSize?:number; overlap?:number; maxChunks?:number }): Chunk[] {
  const chunkSize = opts?.chunkSize ?? 3000
  const overlap = opts?.overlap ?? 300
  const maxChunks = opts?.maxChunks ?? 20
  if (text.length <= chunkSize) return [{index:0, text, start:0, end:text.length}]
  const chunks:Chunk[]=[]
  let start=0; let idx=0
  while(start < text.length && chunks.length < maxChunks){
    const end = Math.min(text.length, start+chunkSize)
    // try break at newline
    let slice = text.slice(start,end)
    if (end < text.length){
      const lastNl = slice.lastIndexOf('\n')
      if (lastNl > chunkSize*0.5) { slice = slice.slice(0,lastNl); }
    }
    chunks.push({index:idx++, text:slice, start, end: start+slice.length})
    if (start+slice.length >= text.length) break
    start = start + slice.length - overlap
  }
  return chunks
}
