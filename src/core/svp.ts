// 声速剖面管理：按 CTD 投放时间/位置为每个 ping 自动挑选剖面

import { toLocal, type LocalOrigin } from "./geodesy"
import type { SvpProfile } from "./types"

// 时间最近优先，时间差相同时取空间最近
export const pickSvp = (
  profiles: SvpProfile[],
  origin: LocalOrigin,
  time: number,
  lat: number,
  lon: number,
): SvpProfile | undefined => {
  let best: SvpProfile | undefined
  let bestDt = Infinity
  let bestD = Infinity
  const pos = toLocal(origin, lat, lon)
  for (const p of profiles) {
    const dt = Math.abs(p.time - time)
    const pp = toLocal(origin, p.lat, p.lon)
    const d = Math.hypot(pp.e - pos.e, pp.n - pos.n)
    if (dt < bestDt || (dt === bestDt && d < bestD)) {
      best = p
      bestDt = dt
      bestD = d
    }
  }
  return best
}
