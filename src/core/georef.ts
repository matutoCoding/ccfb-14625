// 地理配准：波束方向先转到导航系取出射角与方位角，再沿方位角平面做二维声线追踪
// 水平分层假设下这是精确解（姿态/安装偏差影响出射角本身，而非事后旋转终点）
// 图深 = 换能器以下深度 + 吃水 - 升沉(上为正) - 潮位(平均海面向上为正)

import { attitudeMat, matVec, mountingMat, type Vec3 } from "./attitude"
import { toLocal, type LocalOrigin } from "./geodesy"
import { traceBeam } from "./ray_trace"
import type { Attitude, LeverArm, Mounting, SvpLayer } from "./types"

export interface GeorefParams {
  origin: LocalOrigin
  mounting: Mounting
  lever: LeverArm // 换能器相对 GNSS 天线，船体系
  draft: number // 换能器吃水 m
  // 不确定度模型参数
  sigmaTide: number
  sigmaHeave: number
  sigmaRollDeg: number
  sigmaSound: number // 声速/测时综合 m
}

export interface BeamXYZ {
  e: number
  n: number
  depth: number
  across: number // 水平跨距（带符号，右舷为正，仅艏向 0 时有直观意义）
  sigma: number
  ok: boolean
}

// 单波束解算（CPU 参考路径，GPU 着色器逻辑与此一一对应）
export const georefBeam = (
  layers: SvpLayer[],
  lat: number,
  lon: number,
  att: Attitude,
  beamAngle: number,
  ttw: number,
  tide: number,
  prm: GeorefParams,
): BeamXYZ => {
  // 波束单位向量：船体系 → 安装偏差 → 导航系(NED)
  const dirBody: Vec3 = [0, Math.sin(beamAngle), Math.cos(beamAngle)]
  const mMount = mountingMat(prm.mounting.heading, prm.mounting.pitch, prm.mounting.roll)
  const mAtt = attitudeMat(att.heading, att.pitch, att.roll)
  const dirNav = matVec(mAtt, matVec(mMount, dirBody))
  const down = dirNav[2]
  if (down <= 0) return { e: 0, n: 0, depth: 0, across: 0, sigma: 0, ok: false }
  const horiz = Math.hypot(dirNav[0], dirNav[1])
  const takeoff = Math.atan2(horiz, down) // 相对铅垂的出射角
  const azimuth = Math.atan2(dirNav[1], dirNav[0]) // 从北顺时针
  const hit = traceBeam(layers, takeoff, ttw / 2)
  if (!hit.ok) return { e: 0, n: 0, depth: 0, across: 0, sigma: 0, ok: false }
  // 换能器位置 = 天线位置 + 姿态矩阵 × 杆臂
  const leverNav = matVec(mAtt, [prm.lever.x, prm.lever.y, prm.lever.z])
  const pos = toLocal(prm.origin, lat, lon)
  const e = pos.e + leverNav[1] + hit.x * Math.sin(azimuth)
  const n = pos.n + leverNav[0] + hit.x * Math.cos(azimuth)
  // 图深 = 射线深度 + 换能器吃水 - 升沉 - 潮位（吃水定义到换能器，杆臂只影响水平位置）
  const depth = hit.z + prm.draft - att.heave - tide
  // 不确定度：潮位/升沉/声速测时为垂直项，横摇误差随水平跨距放大
  const sigRoll = prm.sigmaRollDeg * Math.PI / 180
  const sigma = Math.sqrt(
    prm.sigmaTide ** 2 +
    prm.sigmaHeave ** 2 +
    prm.sigmaSound ** 2 +
    (hit.x * sigRoll) ** 2,
  )
  return { e, n, depth, across: hit.x * Math.sign(beamAngle), sigma, ok: true }
}
