/**
 * AudioWorklet processor for capturing raw PCM Float32Array chunks.
 * Runs in the AudioWorklet context (separate thread from renderer).
 * Replaces the deprecated ScriptProcessorNode.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare class AudioWorkletProcessor {
  port: MessagePort
}
declare const registerProcessor: (name: string, ctor: any) => void
/* eslint-enable @typescript-eslint/no-explicit-any */

class PCMProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]
    if (input && input[0]) {
      // Copy the channel data (input buffer is reused by the audio engine)
      const channelData = new Float32Array(input[0].length)
      channelData.set(input[0])
      this.port.postMessage({ pcm: channelData })
    }
    return true // Keep processor alive
  }
}

registerProcessor('pcm-processor', PCMProcessor)
