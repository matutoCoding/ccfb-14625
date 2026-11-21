// 潮位：验潮站时间序列线性插值 + 多站按距离平方反比加权；缺测段打标不参与成图

import { toLocal, type LocalOrigin } from "./geodesy"
import type { TideStation } from "./types"

// 单站时间插值，超出覆盖范围返回 null
export const interpStation = (st: TideStation, t: number, toleranceMs: number): number | null => {
  const ts = st.times
  const n = ts.length
  if (n === 0) return null
  if (t < ts[0]! - toleranceMs || t > ts[n - 1]! + toleranceMs) return null
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (ts[mid]! <= t) lo = mid
    else hi = mid
  }
  const t0 = ts[lo]!
  const t1 = ts[hi]!
  const h0 = st.heights[lo]!
  const h1 = st.heights[hi]!
  if (t1 === t0) return h0
  return h0 + (h1 - h0) * (t - t0) / (t1 - t0)
}

export interface TideResult {
  height: number
  missing: boolean
}

// 多站 IDW（幂 2），所有站都缺则 missing
export const tideAt = (
  stations: TideStation[],
  origin: LocalOrigin,
  lat: number,
  lon: number,
  t: number,
  toleranceMs: number,
): TideResult => {
  const pos = toLocal(origin, lat, lon)
  let wSum = 0
  let hSum = 0
  for (const st of stations) {
    const h = interpStation(st, t, toleranceMs)
    if (h === null) continue
    const sp = toLocal(origin, st.lat, st.lon)
    const d2 = (sp.e - pos.e) ** 2 + (sp.n - pos.n) ** 2
    const w = 1 / Math.max(d2, 1)
    wSum += w
    hSum += w * h
  }
  if (wSum === 0) return { height: 0, missing: true }
  return { height: hSum / wSum, missing: false }
}
