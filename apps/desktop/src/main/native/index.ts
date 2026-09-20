/**
 * TypeScript wrapper for the native KV Cache Engine.
 */
import path from 'path'

// Dynamically require the compiled addon (in production this would be in app.getAppPath())
let addon: any
try {
  addon = require(path.join(__dirname, '..', '..', '..', 'build', 'Release', 'cache_engine.node'))
} catch (e) {
  // Graceful fallback if native module isn't compiled
  console.warn('Failed to load cache_engine.node native addon. Make sure to run node-gyp rebuild.')
}

export class KvCacheEngine {
  private engine: any

  constructor(ramBudgetBytes: number, vramBudgetBytes: number, cachePath: string) {
    if (addon && addon.CacheEngine) {
      this.engine = new addon.CacheEngine(ramBudgetBytes, vramBudgetBytes, cachePath)
    }
  }

  public initialize(): boolean {
    if (this.engine) return this.engine.initialize()
    return false
  }

  public beginToken(tokenId: number): void {
    if (this.engine) this.engine.beginToken(tokenId)
  }

  public finishLayer(layerIndex: number): void {
    if (this.engine) this.engine.finishLayer(layerIndex)
  }
}
