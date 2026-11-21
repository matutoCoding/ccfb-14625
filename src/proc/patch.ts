// Patch test 求解：横摇闭式最小二乘，纵摇/艏向扫描重分箱
// 输入为两条测线的解算结果（当前安装偏差下），输出偏差角修正量（度）

import { dbGet, STORES } from "@/db/db"
import type { SurveyLine } from "@/core/types"

export interface Profile {
  e: number[] // 东坐标（分箱键）
  n: number[] // 北坐标（沿航向分箱键，测线均为南北/东西向）
  depth: number[]
  across: number[] // 船体系带符号横向距离
}

// 从 soundings 库提取一条线的剖面（可隔波束抽稀加速）
export const extractProfile = async (line: SurveyLine, stride = 2): Promise<Profile> => {
  const e: number[] = []
  const n: number[] = []
  const depth: number[] = []
  const across: number[] = []
  for (let ci = 0; ci < line.chunkCount; ci++) {
    const buf = await dbGet<ArrayBuffer>(STORES.soundings, [line.id, ci])
    if (!buf) continue
    const arr = new Float32Array(buf)
    for (let i = 0; i < arr.length; i += 8 * stride) {
      if (arr[i + 5] !== 0) continue
      e.push(arr[i]!)
      n.push(arr[i + 1]!)
      depth.push(arr[i + 2]!)
      across.push(arr[i + 3]!)
    }
  }
  return { e, n, depth, across }
}

interface Bin {
  sumD: number
  sumA: number
  cnt: number
}

const binBy = (keys: number[], p: Profile, shift: (i: number) => number, binSize: number): Map<number, Bin> => {
  const m = new Map<number, Bin>()
  for (let i = 0; i < keys.length; i++) {
    const k = Math.round((keys[i]! + shift(i)) / binSize)
    const b = m.get(k)
    if (b) {
      b.sumD += p.depth[i]!
      b.sumA += p.across[i]!
      b.cnt++
    } else {
      m.set(k, { sumD: p.depth[i]!, sumA: p.across[i]!, cnt: 1 })
    }
  }
  return m
}

// 横摇：平坦海底往返测线，按东坐标分箱，深度差对横向距离回归（闭式解）
export const solveRoll = (a: Profile, b: Profile, currentDeg: number): number => {
  const binA = binBy(a.e, a, () => 0, 2)
  const binB = binBy(b.e, b, () => 0, 2)
  let sab = 0
  let sbb = 0
  for (const [k, ba] of binA) {
    const bb = binB.get(k)
    if (!bb || ba.cnt < 3 || bb.cnt < 3) continue
    const diff = ba.sumD / ba.cnt - bb.sumD / bb.cnt
    const dac = ba.sumA / ba.cnt - bb.sumA / bb.cnt
    sab += diff * dac
    sbb += dac * dac
  }
  if (sbb < 1e-9) return currentDeg
  const dRad = -sab / sbb
  return currentDeg + dRad * 180 / Math.PI
}

// 纵摇/艏向：扫描修正量，重分箱后最小化重叠区深度差平方和
const scanSolve = (
  a: Profile,
  b: Profile,
  currentDeg: number,
  shiftFn: (p: Profile, i: number, dRad: number) => number,
  range: number,
): number => {
  const objective = (deg: number): number => {
    const dRad = (deg - currentDeg) * Math.PI / 180
    const binA = binBy(a.n, a, (i) => shiftFn(a, i, dRad), 2)
    const binB = binBy(b.n, b, (i) => shiftFn(b, i, dRad), 2)
    let s = 0
    let cnt = 0
    for (const [k, ba] of binA) {
      const bb = binB.get(k)
      if (!bb || ba.cnt < 3 || bb.cnt < 3) continue
      const d = ba.sumD / ba.cnt - bb.sumD / bb.cnt
      s += d * d
      cnt++
    }
    return cnt > 10 ? s / cnt : Infinity
  }
  // 粗扫 + 细扫
  let best = currentDeg
  let bestV = Infinity
  for (let d = currentDeg - range; d <= currentDeg + range; d += 0.05) {
    const v = objective(d)
    if (v < bestV) {
      bestV = v
      best = d
    }
  }
  for (let d = best - 0.05; d <= best + 0.05; d += 0.005) {
    const v = objective(d)
    if (v < bestV) {
      bestV = v
      best = d
    }
  }
  return best
}

// 纵摇：同向不同速测线过海山，特征沿航向位移 ≈ 深度 × 偏差角
export const solvePitch = (a: Profile, b: Profile, currentDeg: number): number =>
  scanSolve(a, b, currentDeg, (p, i, d) => p.depth[i]! * d, 2)

// 艏向：往返测线过海山，特征沿航向位移 ≈ 横向距离 × 偏差角
export const solveHeading = (a: Profile, b: Profile, currentDeg: number): number =>
  scanSolve(a, b, currentDeg, (p, i, d) => p.across[i]! * d, 2)
