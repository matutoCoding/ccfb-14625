// 端到端验证：模拟生成 → 处理链解算 → 与真实海底比对
// 用真值安装偏差解算，深度应回到真实海底（残差仅含注入噪声）

import { describe, expect, it } from "vitest"

import { georefBeam, type GeorefParams } from "@/core/georef"
import { buildLayers } from "@/core/ray_trace"
import { DRAFT, LEVER, mulberry32, ORIGIN, TRUE_MOUNTING } from "@/sim/generate"
import { genLine } from "@/sim/generate_line"
import { seabedDepth } from "@/sim/seabed"
import type { SvpProfile } from "@/core/types"

const T0 = 1_760_000_000_000 // 固定起点，可复现

const svp: SvpProfile[] = [{
  id: "svp_t", name: "T", time: T0, lat: 30, lon: 122,
  points: [
    { z: 0, c: 1534 }, { z: 10, c: 1532 }, { z: 25, c: 1519 },
    { z: 50, c: 1504 }, { z: 80, c: 1495 }, { z: 120, c: 1491 },
    { z: 200, c: 1494 }, { z: 300, c: 1499 },
  ],
}]

// 与生成端一致的潮位真值
const tideTrue = (tMs: number): number =>
  1.55 * Math.sin(2 * Math.PI * (tMs / 1000 / 3600 - 2.2) / 12.42)

describe("端到端：生成 → 解算 → 对比真实海底", () => {
  it("真值安装偏差下，中央波束深度无系统偏差", { timeout: 120_000 }, async () => {
    const rng = mulberry32(7)
    const spec = { name: "T1", e: 2200, n0: 600, n1: 1100, heading: 0, speedKn: 5, kind: "survey" as const }
    const { line, chunks } = await genLine("vtest", spec, svp, T0, rng, 0)
    const prm: GeorefParams = {
      origin: ORIGIN,
      mounting: { ...TRUE_MOUNTING },
      lever: { ...LEVER },
      draft: DRAFT,
      sigmaTide: 0.05, sigmaHeave: 0.05, sigmaRollDeg: 0.05, sigmaSound: 0.1,
    }
    const layers = buildLayers(svp[0]!.points, 1000)
    const errs: number[] = []
    for (const chunk of chunks) {
      for (let p = 0; p < chunk.count; p += 3) {
        const h = chunk.heads[p]!
        const tide = tideTrue(h.time)
        for (let b = 0; b < line.nBeams; b++) {
          const i = p * line.nBeams + b
          const beta = chunk.beamAngle[i]!
          if (Math.abs(beta) > 40 * Math.PI / 180) continue // 只看中央波束
          const ttw = chunk.travelTime[i]!
          if (ttw <= 0) continue
          const hit = georefBeam(layers, h.lat, h.lon, h.att, beta, ttw, tide, prm)
          if (!hit.ok) continue
          errs.push(hit.depth - seabedDepth(hit.e, hit.n))
        }
      }
    }
    expect(errs.length).toBeGreaterThan(5000)
    const mean = errs.reduce((s, v) => s + v, 0) / errs.length
    const rms = Math.sqrt(errs.reduce((s, v) => s + v * v, 0) / errs.length)
    console.log(`样本 ${errs.length}，系统偏差 ${(mean * 1000).toFixed(1)} mm，RMS ${(rms * 1000).toFixed(1)} mm`)
    // 系统偏差 < 5cm（几何链正确性），RMS < 30cm（含注入噪声）
    expect(Math.abs(mean)).toBeLessThan(0.05)
    expect(rms).toBeLessThan(0.3)
  })

  it("错误安装偏差产生可解算的系统性畸变（patch test 前提）", { timeout: 120_000 }, async () => {
    const rng = mulberry32(8)
    const spec = { name: "T2", e: 2200, n0: 600, n1: 900, heading: 0, speedKn: 5, kind: "survey" as const }
    const { line, chunks } = await genLine("vtest2", spec, svp, T0, rng, 0)
    const mkPrm = (roll: number): GeorefParams => ({
      origin: ORIGIN, mounting: { roll, pitch: 0, heading: 0, latency: 0 },
      lever: { ...LEVER }, draft: DRAFT,
      sigmaTide: 0.05, sigmaHeave: 0.05, sigmaRollDeg: 0.05, sigmaSound: 0.1,
    })
    const layers = buildLayers(svp[0]!.points, 1000)
    // 外侧波束在错误横摇下的深度差应 ≈ across × Δroll
    const chunk = chunks[0]!
    const h = chunk.heads[10]!
    const tide = tideTrue(h.time)
    const i = 10 * line.nBeams + 400 // 外侧波束
    const beta = chunk.beamAngle[i]!
    const ttw = chunk.travelTime[i]!
    const a = georefBeam(layers, h.lat, h.lon, h.att, beta, ttw, tide, mkPrm(TRUE_MOUNTING.roll))
    const b = georefBeam(layers, h.lat, h.lon, h.att, beta, ttw, tide, mkPrm(TRUE_MOUNTING.roll + 1))
    const expected = a.across * (1 * Math.PI / 180)
    // 折射路径下 Δdepth ≈ across·Δroll 为一阶近似，容差 0.1m
    expect(Math.abs(Math.abs(a.depth - b.depth) - Math.abs(expected))).toBeLessThan(0.1)
  })
})
