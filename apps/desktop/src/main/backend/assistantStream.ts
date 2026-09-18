export type StreamChunk = { type: 'text-delta'; index: number; text: string } | { type: 'reasoning-delta'; index: number; text: string } | { type: 'tool-call-delta'; index: number; id: string; name?: string; argumentsDelta: string } | { type: 'block-start'| 'block-end'|'usage'|'finish'; [k:string]: unknown }
export interface TimedStreamChunk { time: number; chunk: StreamChunk }
export class AssistantStreamAccumulator {
  private records: any[] = []
  push(v: TimedStreamChunk): TimedStreamChunk {
    const last = this.records.at(-1)
    if (v.chunk.type==='text-delta' || v.chunk.type==='reasoning-delta') {
      const type = v.chunk.type==='text-delta'?'text-chunks':'reasoning-chunks'
      if (last?.type===type && last.index===v.chunk.index) { last.dt.push(v.time-(last.lastTime||v.time)); last.texts.push(v.chunk.text); last.lastTime=v.time; return v }
      this.records.push({ type, time0: v.time, index: v.chunk.index, dt: [], texts: [v.chunk.text], lastTime: v.time }); return v
    }
    if (v.chunk.type==='tool-call-delta') {
      if (last?.type==='tool-call-chunks' && last.index===v.chunk.index && last.id===v.chunk.id) { last.dt.push(v.time-last.lastTime); last.args.push(v.chunk.argumentsDelta); last.lastTime=v.time; return v }
      this.records.push({ type:'tool-call-chunks', time0: v.time, index: v.chunk.index, dt: [], id: v.chunk.id, name: (v.chunk as any).name, args: [v.chunk.argumentsDelta], lastTime: v.time }); return v
    }
    this.records.push({ type:'chunk', time: v.time, chunk: v.chunk }); return v
  }
  snapshot(): readonly any[] { return this.records.map(r=> { const {lastTime,...rest}=r; return rest }) }
}
