// 独立验证器：沿程 RK4 数值积分解同一射线方程，与 ray_trace 的分层解析解互为独立路径
// 射线方程：dx/ds=sinθ, dz/ds=cosθ, dθ/ds=p·g(z), dt/ds=1/c(z)，s 为弧长

import type { SvpPoint } from "./types"

// 剖面线性插值取声速与局部梯度
const sampleC = (pts: SvpPoint[], z: number): { c: number; g: number } => {
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  if (z <= first.z) {
    const p1 = pts[1] ?? first
    return { c: first.c, g: (p1.c - first.c) / Math.max(p1.z - first.z, 1e-6) }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    if (z >= a.z && z <= b.z) {
      const g = (b.c - a.c) / (b.z - a.z)
      return { c: a.c + g * (z - a.z), g }
    }
  }
  const pN = pts[pts.length - 2] ?? last
  return { c: last.c, g: (last.c - pN.c) / Math.max(last.z - pN.z, 1e-6) }
}

export interface NumHit {
  x: number
  z: number
  t: number
}

// RK4 积分到单程时间耗尽，ds 取 0.02m 足够收敛到毫米级以下
export const traceBeamNumeric = (
  points: SvpPoint[],
  theta0: number,
  tOneWay: number,
  ds = 0.02,
): NumHit => {
  const pts = points.slice().sort((a, b) => a.z - b.z)
  const p = Math.sin(theta0) / sampleC(pts, 0).c
  let x = 0
  let z = 0
  let theta = theta0
  let t = 0
  while (t < tOneWay) {
    const h = Math.min(ds, (tOneWay - t) * sampleC(pts, z).c * 0.5 + 1e-9)
    // 状态导数 f(s) = (sinθ, cosθ, p·g, 1/c)
    const f = (zz: number, th: number) => {
      const { c, g } = sampleC(pts, Math.max(zz, 0))
      return { dx: Math.sin(th), dz: Math.cos(th), dth: p * g, dt: 1 / c }
    }
    const k1 = f(z, theta)
    const k2 = f(z + k1.dz * h / 2, theta + k1.dth * h / 2)
    const k3 = f(z + k2.dz * h / 2, theta + k2.dth * h / 2)
    const k4 = f(z + k3.dz * h, theta + k3.dth * h)
    x += h * (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx) / 6
    z += h * (k1.dz + 2 * k2.dz + 2 * k3.dz + k4.dz) / 6
    theta += h * (k1.dth + 2 * k2.dth + 2 * k3.dth + k4.dth) / 6
    t += h * (k1.dt + 2 * k2.dt + 2 * k3.dt + k4.dt) / 6
    if (z < 0) break // 折返回水面
  }
  return { x, z, t }
}
