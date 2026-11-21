// 性能基准：2 万 ping × 512 波束全测线重算（CPU 参考路径）
// GPU 路径在浏览器内由 recompute 模块计时，此测试给出 CPU 基线并验证吞吐量

import { describe, expect, it } from "vitest"

import { buildLayers, traceSwath } from "@/core/ray_trace"
import type { SvpPoint } from "@/core/types"

const SVP: SvpPoint[] = [
  { z: 0, c: 1535 }, { z: 10, c: 1533 }, { z: 25, c: 1521 },
  { z: 50, c: 1505 }, { z: 80, c: 1496 }, { z: 120, c: 1492 },
  { z: 200, c: 1495 }, { z: 400, c: 1501 },
]

describe("重算吞吐", () => {
  it("20000 ping × 512 波束 CPU 基线", { timeout: 300_000 }, () => {
    const layers = buildLayers(SVP, 500)
    const nPing = 20_000
    const nBeam = 512
    const angles = new Float32Array(nBeam)
    const ttw = new Float32Array(nBeam)
    for (let b = 0; b < nBeam; b++) {
      angles[b] = (-65 + (130 * b) / (nBeam - 1)) * Math.PI / 180
      ttw[b] = 0.15 + 0.1 * Math.abs(Math.sin(b / 31))
    }
    const outX = new Float32Array(nBeam)
    const outZ = new Float32Array(nBeam)
    const outF = new Uint8Array(nBeam)
    const t0 = performance.now()
    for (let p = 0; p < nPing; p++) traceSwath(layers, angles, ttw, outX, outZ, outF)
    const ms = performance.now() - t0
    const beams = nPing * nBeam
    console.log(`CPU 基线: ${beams} 波束, ${ms.toFixed(0)} ms, ${(beams / ms / 1000).toFixed(1)} M波束/s`)
    // CPU 参考路径至少 1M 波束/s，GPU 路径目标为 5s 内（浏览器端验证）
    expect(beams / ms / 1000).toBeGreaterThan(1)
  })
})
