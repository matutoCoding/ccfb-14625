// 声线追踪正确性验证：解析解 vs 独立 RK4 数值积分 vs 闭式公式
// 验收标准：同一波束深度差 < 水深的千分之一

import { describe, expect, it } from "vitest"

import { buildLayers, traceBeam } from "@/core/ray_trace"
import { traceBeamNumeric } from "@/core/ray_trace_num"
import type { SvpPoint } from "@/core/types"

const D2R = Math.PI / 180

// 真实感剖面：表层混合层 + 负梯度温跃层 + 深水弱正梯度
const REAL_SVP: SvpPoint[] = [
  { z: 0, c: 1535.0 },
  { z: 10, c: 1533.2 },
  { z: 25, c: 1520.8 },
  { z: 50, c: 1505.1 },
  { z: 80, c: 1496.4 },
  { z: 120, c: 1492.0 },
  { z: 200, c: 1494.5 },
  { z: 400, c: 1501.0 },
  { z: 800, c: 1512.0 },
]

describe("常声速闭式解", () => {
  const svp: SvpPoint[] = [{ z: 0, c: 1500 }, { z: 1000, c: 1500 }]
  const layers = buildLayers(svp, 1000)
  it("平直射线下深度/跨距与 c·t 公式一致", () => {
    for (const deg of [0, 15, 30, 45, 60, 70]) {
      const theta = deg * D2R
      const t = 0.4 // 单程秒
      const hit = traceBeam(layers, theta, t)
      const expectZ = 1500 * t * Math.cos(theta)
      const expectX = 1500 * t * Math.sin(theta)
      expect(Math.abs(hit.z - expectZ)).toBeLessThan(1e-9)
      expect(Math.abs(hit.x - expectX)).toBeLessThan(1e-9)
    }
  })
})

describe("分层常梯度解析解 vs RK4 数值积分", () => {
  const layers = buildLayers(REAL_SVP, 1000)
  const cases: Array<[number, number]> = [] // [角度deg, 单程时间s]
  for (const deg of [0, 5, 15, 25, 35, 45, 55, 60, 65, 70]) {
    for (const t of [0.05, 0.13, 0.27, 0.4]) cases.push([deg, t])
  }
  it.each(cases)("角度 %f deg 时间 %f s：深度差 < 水深千分之一", (deg, t) => {
    const theta = deg * D2R
    const a = traceBeam(layers, theta, t)
    const b = traceBeamNumeric(REAL_SVP, theta, t)
    const tol = Math.abs(b.z) / 1000
    expect(Math.abs(a.z - b.z)).toBeLessThan(tol)
    expect(Math.abs(a.x - b.x)).toBeLessThan(Math.max(Math.abs(b.x), 1) / 1000)
  })

  it("左右舷对称", () => {
    const p = traceBeam(layers, 40 * D2R, 0.2)
    const s = traceBeam(layers, -40 * D2R, 0.2)
    expect(Math.abs(p.z - s.z)).toBeLessThan(1e-9)
    expect(Math.abs(p.x + s.x)).toBeLessThan(1e-9)
  })

  it("正下方波束（p≈0 分支）与数值解一致", () => {
    const a = traceBeam(layers, 0, 0.3)
    const b = traceBeamNumeric(REAL_SVP, 0, 0.3)
    expect(Math.abs(a.z - b.z)).toBeLessThan(Math.abs(b.z) / 1000)
    expect(Math.abs(a.x)).toBeLessThan(1e-9)
  })
})

describe("强正梯度折射翻转", () => {
  it("翻转波束标记为未到底", () => {
    const svp: SvpPoint[] = [{ z: 0, c: 1480 }, { z: 500, c: 1560 }]
    const layers = buildLayers(svp, 500)
    const hit = traceBeam(layers, 80 * D2R, 2.0)
    expect(hit.ok).toBe(false)
  })
})
