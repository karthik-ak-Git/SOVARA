import { describe, expect, it } from 'vitest'
import { estimateExplorerFit } from '../../src/main/services/explorerFit'
import { estimateCompatibility } from '../../src/main/services/hardwareCheck'
import { classifyGpu } from '../../src/main/services/hardwareProfile'
import { sandboxProfiles } from './profiles'

describe('hardware sandbox — laptop through server range', () => {
  it.each(sandboxProfiles)('$id selects the expected owned-runtime placement', ({ hardware, model, expected }) => {
    const file = model.files[0]
    expect(file).toBeDefined()

    const fit = estimateExplorerFit(file!, model, hardware, { contextLength: 4096 })
    expect(fit.fit).toBe(expected)

    const compatibility = estimateCompatibility(model, hardware, 4096)
    if (expected === 'fullGPUOffload') {
      expect(compatibility.fitsInMemory).toBe(true)
      expect(compatibility.message).toMatch(/VRAM|GPU/i)
    } else {
      expect(compatibility.fitsInMemory).toBe(true)
      expect(compatibility.message).toMatch(/CPU|RAM/i)
    }
  })

  it('does not let a Ryzen CPU label override an NVIDIA GPU', () => {
    const profile = sandboxProfiles.find((entry) => entry.id === 'ryzen-nvidia-laptop')
    expect(profile).toBeDefined()
    expect(profile?.hardware.gpuAvailable).toBe(true)
    expect(profile?.hardware.gpuRuntime).toBe('cuda')
    expect(profile?.expected).toBe('fullGPUOffload')
  })

  it('classifies detected vendors without claiming unsupported CUDA', () => {
    expect(classifyGpu('NVIDIA GeForce RTX 4060 Laptop GPU', 8192)).toMatchObject({
      gpuVendor: 'NVIDIA', gpuRuntime: 'cuda', gpuAvailable: true,
    })
    expect(classifyGpu('AMD Radeon RX 7800M', 8192)).toMatchObject({
      gpuVendor: 'AMD', gpuRuntime: 'cpu', gpuAvailable: false,
    })
    expect(classifyGpu('Intel Arc Graphics', 4096)).toMatchObject({
      gpuVendor: 'Intel', gpuRuntime: 'cpu', gpuAvailable: false,
    })
  })
})
