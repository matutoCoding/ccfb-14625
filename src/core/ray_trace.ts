// 分层常梯度声线追踪：Snell 定律 p = sinθ/c 守恒，每层内声线为圆弧，dx/dz/dt 全部闭式解
// 约定：θ 为相对垂直方向（换能器正下方）的夹角 rad，右舷为正；z 向下为正；t 为单程旅行时

import type { SvpLayer, SvpPoint } from "./types"

const G_EPS = 1e-9
const P_EPS = 1e-9

// 由 CTD 剖面点构造分层模型，顶部/底部用最外点声速外推，保证覆盖 [0, maxZ]
export const buildLayers = (points: SvpPoint[], maxZ: number): SvpLayer[] => {
  const pts = points.slice().sort((a, b) => a.z - b.z)
  const layers: SvpLayer[] = []
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  const zs: number[] = [0]
  const cs: number[] = [first.c]
  for (const p of pts) {
    if (p.z <= 0) continue
    zs.push(p.z)
    cs.push(p.c)
  }
  if (zs[zs.length - 1]! < maxZ) {
    zs.push(maxZ)
    cs.push(last.c)
  }
  for (let i = 0; i < zs.length - 1; i++) {
    const z0 = zs[i]!
    const z1 = zs[i + 1]!
    const c0 = cs[i]!
    const c1 = cs[i + 1]!
    layers.push({ z0, z1, c0, g: (c1 - c0) / (z1 - z0) })
  }
  return layers
}

export interface RayHit {
  x: number // 水平跨距 m（右舷为正）
  z: number // 换能器以下深度 m
  t: number // 实际用掉的单程时间 s
  ok: boolean // false = 声线翻转未到底
}

// 单波束追踪，tOneWay 为单程旅行时（双程/2）
export const traceBeam = (layers: SvpLayer[], theta0: number, tOneWay: number): RayHit => {
  let x = 0
  let z = 0
  let tLeft = tOneWay
  const c0 = layers[0]!.c0
  const p = Math.sin(theta0) / c0
  let theta = theta0
  for (const L of layers) {
    if (tLeft <= 0) break
    const dzLayer = L.z1 - L.z0
    if (Math.abs(L.g) < G_EPS) {
      // 等速层，直线
      const cosT = Math.cos(theta)
      if (cosT <= 0) return { x, z, t: tOneWay - tLeft, ok: false }
      const tFull = dzLayer / (L.c0 * cosT)
      const dt = Math.min(tFull, tLeft)
      x += L.c0 * dt * Math.sin(theta)
      z += L.c0 * dt * cosT
      tLeft -= dt
      continue
    }
    if (Math.abs(p) < P_EPS) {
      // 正下方波束，垂直走
      const c1 = L.c0 + L.g * dzLayer
      const tFull = Math.log(c1 / L.c0) / L.g
      const dt = Math.min(tFull, tLeft)
      const cEnd = L.c0 * Math.exp(L.g * dt)
      z += (cEnd - L.c0) / L.g
      tLeft -= dt
      theta = 0
      continue
    }
    const c1 = L.c0 + L.g * dzLayer
    const sinT2 = p * c1
    if (sinT2 >= 1 || sinT2 <= -1) {
      // 层内折射翻转（声线转向水平后折返），该波束不到底
      const cTurn = 1 / Math.abs(p)
      const dzTurn = (cTurn - L.c0) / L.g
      if (dzTurn > 0 && dzTurn < dzLayer) {
        const th1 = theta
        const th2 = Math.sign(p) * Math.PI / 2
        x += (Math.cos(th1) - Math.cos(th2)) / (p * L.g)
        z += (Math.sin(th2) - Math.sin(th1)) / (p * L.g)
        return { x, z, t: tOneWay - tLeft, ok: false }
      }
    }
    const th1 = theta
    const th2 = Math.asin(Math.max(-1, Math.min(1, sinT2)))
    const tFull = Math.log(Math.tan(th2 / 2) / Math.tan(th1 / 2)) / L.g
    const dt = Math.min(Math.max(tFull, 0), tLeft)
    const thEnd = dt >= tFull ? th2 : 2 * Math.atan(Math.tan(th1 / 2) * Math.exp(L.g * dt))
    x += (Math.cos(th1) - Math.cos(thEnd)) / (p * L.g)
    z += (Math.sin(thEnd) - Math.sin(th1)) / (p * L.g)
    tLeft -= dt
    theta = thEnd
  }
  return { x, z, t: tOneWay - tLeft, ok: true }
}

// 整条 ping 的批量追踪，结果写入预分配数组（CPU 回退路径 / 测试用）
export const traceSwath = (
  layers: SvpLayer[],
  angles: Float32Array,
  ttw: Float32Array,
  outX: Float32Array,
  outZ: Float32Array,
  outFlag: Uint8Array,
): void => {
  for (let i = 0; i < angles.length; i++) {
    const hit = traceBeam(layers, angles[i]!, ttw[i]! / 2)
    outX[i] = hit.x
    outZ[i] = hit.z
    outFlag[i] = hit.ok ? 0 : 2
  }
}
