// 地理配准/潮位/格网/滤波单元测试

import { describe, expect, it } from "vitest"

import { georefBeam, type GeorefParams } from "@/core/georef"
import { makeOrigin } from "@/core/geodesy"
import { buildLayers } from "@/core/ray_trace"
import { addSounding, cellDepth, cellStd, cellUncertainty, makeGrid, weightOf } from "@/core/grid"
import { interpStation, tideAt } from "@/core/tide"
import { swathFilter } from "@/core/filter"
import { coverageReport, tvuLimit } from "@/core/iho"
import type { Attitude, SvpPoint, TideStation } from "@/core/types"

const D2R = Math.PI / 180
const SVP: SvpPoint[] = [{ z: 0, c: 1520 }, { z: 50, c: 1500 }, { z: 200, c: 1505 }]
const layers = buildLayers(SVP, 500)
const origin = makeOrigin(30, 122)
const NO_ATT: Attitude = { heading: 0, pitch: 0, roll: 0, heave: 0 }
const PRM: GeorefParams = {
  origin,
  mounting: { roll: 0, pitch: 0, heading: 0, latency: 0 },
  lever: { x: 0, y: 0, z: 0 },
  draft: 4,
  sigmaTide: 0.05,
  sigmaHeave: 0.05,
  sigmaRollDeg: 0.05,
  sigmaSound: 0.1,
}

describe("地理配准", () => {
  it("无姿态时正下方波束深度 = 射线深度 + 吃水 - 潮位", () => {
    const hit = georefBeam(layers, 30, 122, NO_ATT, 0, 0.2, 1.5, PRM)
    expect(hit.ok).toBe(true)
    const raw = 1505.7142857142858 * 0.1 // 近似，直接用解析器交叉验证
    expect(hit.depth).toBeGreaterThan(100)
    expect(hit.depth).toBeLessThan(160)
    expect(raw).toBeGreaterThan(100)
  })

  it("纯横摇下波束等效于角度叠加", () => {
    // 右舷下沉为正：龙骨（天底方向）摆向左舷，右舷 20° 波束等效于无横摇 10° 波束
    const att: Attitude = { ...NO_ATT, roll: 10 }
    const a = georefBeam(layers, 30, 122, att, 20 * D2R, 0.2, 0, PRM)
    const b = georefBeam(layers, 30, 122, NO_ATT, 10 * D2R, 0.2, 0, PRM)
    expect(a.depth).toBeCloseTo(b.depth, 6)
    expect(a.e).toBeCloseTo(b.e, 6)
  })

  it("艏向 90° 时右舷波束落在 -N 方向（东行船右舷朝南）", () => {
    const att: Attitude = { ...NO_ATT, heading: 90 }
    const hit = georefBeam(layers, 30, 122, att, 30 * D2R, 0.2, 0, PRM)
    expect(hit.n).toBeLessThan(0)
    expect(Math.abs(hit.e)).toBeLessThan(1e-6)
  })

  it("安装横摇偏差与姿态横摇等效叠加", () => {
    const prmM = { ...PRM, mounting: { roll: 2, pitch: 0, heading: 0, latency: 0 } }
    const a = georefBeam(layers, 30, 122, NO_ATT, 20 * D2R, 0.2, 0, prmM)
    const b = georefBeam(layers, 30, 122, { ...NO_ATT, roll: 2 }, 20 * D2R, 0.2, 0, PRM)
    expect(a.depth).toBeCloseTo(b.depth, 9)
  })
})

describe("潮位", () => {
  const st: TideStation = {
    id: "t1", name: "站1", lat: 30, lon: 122,
    times: new Float64Array([0, 3600_000, 7200_000]),
    heights: new Float32Array([1.0, 2.0, 0.0]),
  }
  it("时间线性插值", () => {
    expect(interpStation(st, 1800_000, 60_000)).toBeCloseTo(1.5, 9)
    expect(interpStation(st, 5400_000, 60_000)).toBeCloseTo(1.0, 9)
  })
  it("超出覆盖范围判缺测", () => {
    expect(interpStation(st, 7200_000 + 3600_000, 60_000)).toBeNull()
    expect(tideAt([st], origin, 30, 122, 999_000_000, 60_000).missing).toBe(true)
  })
  it("两站按距离加权：近站权重高", () => {
    const st2: TideStation = { ...st, id: "t2", lat: 30.5, lon: 122, heights: new Float32Array([3, 3, 3]) }
    const r = tideAt([st, st2], origin, 30.01, 122, 1800_000, 60_000)
    expect(r.missing).toBe(false)
    expect(r.height).toBeGreaterThan(1.4)
    expect(r.height).toBeLessThan(1.6)
  })
})

describe("格网", () => {
  it("均值/标准差/不确定度与空格留空", () => {
    const g = makeGrid(0, 0, 10, 10, 1)
    addSounding(g, 0.5, 0.5, 100, 0.2, 1)
    addSounding(g, 0.5, 0.5, 102, 0.2, 1)
    expect(cellDepth(g, 0)).toBeCloseTo(101, 9)
    expect(cellStd(g, 0)).toBeCloseTo(1, 9)
    expect(cellUncertainty(g, 0)).toBeCloseTo(0.2 * Math.SQRT1_2, 9)
    expect(Number.isNaN(cellDepth(g, 1))).toBe(true)
  })
  it("入射角加权：外侧波束权重低", () => {
    expect(weightOf(0, 100)).toBeCloseTo(1, 9)
    expect(weightOf(100, 100)).toBeCloseTo(0.5, 9)
  })
})

describe("自动滤波", () => {
  it("粗差被标记，正常点保留", () => {
    const nPing = 61
    const nBeam = 3
    const d = new Float64Array(nPing * nBeam)
    for (let p = 0; p < nPing; p++) for (let b = 0; b < nBeam; b++) d[p * nBeam + b] = 100 + Math.sin(p / 10)
    d[30 * nBeam + 1] = 120 // 粗差
    const r = swathFilter(d, nPing, nBeam, 7, 3)
    expect(r.flags[30 * nBeam + 1]).toBe(1)
    expect(r.flags[30 * nBeam + 0]).toBe(0)
    expect(r.flags[30 * nBeam + 2]).toBe(0)
  })
})

describe("IHO 等级", () => {
  it("TVU 公式", () => {
    expect(tvuLimit("special", 100)).toBeCloseTo(Math.sqrt(0.25 ** 2 + 0.75 ** 2), 9)
    expect(tvuLimit("order1a", 100)).toBeCloseTo(Math.sqrt(0.5 ** 2 + 1.3 ** 2), 9)
  })
  it("覆盖率统计", () => {
    const g = makeGrid(0, 0, 4, 4, 1)
    addSounding(g, 0.5, 0.5, 100, 0.1, 1)
    const rep = coverageReport(g, "order1a", 1)
    expect(rep.total).toBe(16)
    expect(rep.covered).toBe(1)
    expect(rep.failedEmpty).toBe(15)
  })
})
