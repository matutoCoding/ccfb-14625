// 单条测线生成：姿态（含跳变）、GNSS、逐波束沿程积分求旅行时、噪声与粗差

import { attitudeMat, matVec, mountingMat, type Vec3 } from "@/core/attitude"
import { toGeo } from "@/core/geodesy"
import { pickSvp } from "@/core/svp"
import type { Attitude, PingChunk, PingHead, SvpProfile, SurveyLine } from "@/core/types"
import { seabedDepth } from "./seabed"
import { DRAFT, LEVER, ORIGIN, TRUE_MOUNTING, type LineSpec } from "./generate"

const N_BEAM = 512
const SWATH_RAD = 65 * Math.PI / 180
const CHUNK = 1024
const PING_DT_MS = 500

// c(z) 查表（1m 分辨率）
const cTable = (pts: { z: number; c: number }[], zMax: number): Float32Array => {
  const t = new Float32Array(zMax + 1)
  let k = 0
  for (let z = 0; z <= zMax; z++) {
    while (k < pts.length - 2 && pts[k + 1]!.z < z) k++
    const a = pts[k]!
    const b = pts[k + 1]!
    t[z] = z <= a.z ? a.c : z >= b.z ? b.c : a.c + (b.c - a.c) * (z - a.z) / (b.z - a.z)
  }
  return t
}

// 沿程积分求双程旅行时（生成端独立实现，欧拉步进 1m）
const marchTtw = (ct: Float32Array, theta0: number, txE: number, txN: number, azimuth: number, txDepth: number): number => {
  const p = Math.sin(theta0) / ct[0]!
  let r = 0
  let z = 0
  let theta = theta0
  let t = 0
  const ds = 1.0
  const sinAz = Math.sin(azimuth)
  const cosAz = Math.cos(azimuth)
  for (let i = 0; i < 2000; i++) {
    const zi = Math.min(ct.length - 2, Math.max(0, Math.round(z)))
    const c = ct[zi]!
    const g = ct[zi + 1]! - c
    r += Math.sin(theta) * ds
    z += Math.cos(theta) * ds
    theta += p * g * ds
    t += ds / c
    const bottom = seabedDepth(txE + r * sinAz, txN + r * cosAz)
    if (z + txDepth >= bottom) {
      // 线性回退过冲，避免整步误差
      const over = z + txDepth - bottom
      const cosT = Math.max(Math.cos(theta - p * g * ds), 0.05)
      const frac = Math.min(1, over / (ds * cosT))
      t -= frac * ds / c
      return t * 2
    }
    if (z < -1 || Math.cos(theta) <= 0) return -1
  }
  return -1
}

export const genLine = async (
  voyageId: string,
  spec: LineSpec,
  svp: SvpProfile[],
  t0: number,
  rng: () => number,
  lineIdx: number,
): Promise<{ line: SurveyLine; chunks: PingChunk[] }> => {
  const lineId = `l_${voyageId}_${spec.name.toLowerCase()}`
  const speed = spec.speedKn * 0.5144
  const spacing = speed * (PING_DT_MS / 1000)
  const trackLen = spec.n1 - spec.n0
  const nPing = Math.floor(trackLen / spacing)
  const hdgRad = spec.heading * Math.PI / 180
  const sinH = Math.sin(hdgRad)
  const cosH = Math.cos(hdgRad)
  const startN = spec.heading === 0 ? spec.n0 : spec.n1
  const lineT0 = t0 + lineIdx * 1.2 * 3600_000 // 各线错开时段，覆盖不同潮位/剖面
  const mMount = mountingMat(TRUE_MOUNTING.heading, TRUE_MOUNTING.pitch, TRUE_MOUNTING.roll)
  const ct = cTable(svp[0]!.points, 300)
  const chunks: PingChunk[] = []
  // 姿态跳变状态
  let rollJump = 0
  let jumpLeft = 0
  let heads: PingHead[] = []
  let angles = new Float32Array(CHUNK * N_BEAM)
  let tts = new Float32Array(CHUNK * N_BEAM)
  let inChunk = 0
  let chunkIdx = 0
  const flush = () => {
    if (inChunk === 0) return
    chunks.push({
      lineId,
      startPing: chunkIdx * CHUNK,
      count: inChunk,
      heads,
      beamAngle: angles.slice(0, inChunk * N_BEAM),
      travelTime: tts.slice(0, inChunk * N_BEAM),
    })
    heads = []
    angles = new Float32Array(CHUNK * N_BEAM)
    tts = new Float32Array(CHUNK * N_BEAM)
    inChunk = 0
    chunkIdx++
  }
  for (let p = 0; p < nPing; p++) {
    if (p > 0 && p % CHUNK === 0) {
      flush()
      if (p % (CHUNK * 4) === 0) await new Promise((r) => setTimeout(r, 0)) // 让出主线程
    }
    const t = lineT0 + p * PING_DT_MS
    const ts = t / 1000
    // 姿态跳变：随机触发，持续若干 ping
    if (jumpLeft > 0) {
      jumpLeft--
    } else if (rng() < 0.01) {
      rollJump = (rng() > 0.5 ? 1 : -1) * (1 + rng() * 1.5)
      jumpLeft = 5 + Math.floor(rng() * 10)
    } else {
      rollJump = 0
    }
    const att: Attitude = {
      heading: spec.heading + 0.5 * Math.sin(ts / 120) + (rng() - 0.5) * 0.4,
      pitch: 0.8 * Math.sin(2 * Math.PI * ts / 12 + 1) + (rng() - 0.5) * 0.3,
      roll: 1.2 * Math.sin(2 * Math.PI * ts / 10) + (rng() - 0.5) * 0.5 + rollJump,
      heave: 0.25 * Math.sin(2 * Math.PI * ts / 8) + (rng() - 0.5) * 0.08,
    }
    const dist = p * spacing
    const txE = spec.e + sinH * dist
    const txN = startN + cosH * dist
    // 天线位置 = 换能器位置 - R_att·杆臂，加 GNSS 噪声
    const mAtt = attitudeMat(att.heading, att.pitch, att.roll)
    const leverNav = matVec(mAtt, [LEVER.x, LEVER.y, LEVER.z])
    const antE = txE - leverNav[1] + (rng() - 0.5) * 0.6
    const antN = txN - leverNav[0] + (rng() - 0.5) * 0.6
    const geo = toGeo(ORIGIN, antE, antN)
    const cast = pickSvp(svp, ORIGIN, t, geo.lat, geo.lon)!
    heads.push({
      time: Math.round(t),
      lat: geo.lat,
      lon: geo.lon,
      att,
      svpId: cast.id,
      tideMissing: false,
    })
    // 瞬时换能器深度（相对基准面）：吃水 - 升沉 - 潮位（潮位在生成端用真值近似：正弦）
    const tideTrue = 1.55 * Math.sin(2 * Math.PI * (ts / 3600 - 2.2) / 12.42)
    const txDepth = DRAFT - att.heave - tideTrue
    for (let b = 0; b < N_BEAM; b++) {
      const beta = -SWATH_RAD + (2 * SWATH_RAD * b) / (N_BEAM - 1)
      const dirBody: Vec3 = [0, Math.sin(beta), Math.cos(beta)]
      const dirNav = matVec(mAtt, matVec(mMount, dirBody))
      const down = dirNav[2]
      let ttw = -1
      if (down > 0.05) {
        const horiz = Math.hypot(dirNav[0], dirNav[1])
        const takeoff = Math.atan2(horiz, down)
        const azimuth = Math.atan2(dirNav[1], dirNav[0])
        ttw = marchTtw(ct, takeoff, txE, txN, azimuth, txDepth)
      }
      if (ttw > 0) {
        // 噪声：基础 + 外侧波束放大
        const outF = Math.abs(beta) / SWATH_RAD
        const sig = ttw * 0.0008 * (1 + 12 * outF ** 4)
        ttw += (rng() + rng() - 1) * 1.732 * sig
        // 外侧波束粗差
        if (outF > 0.85 && rng() < 0.006) ttw *= 1 + (rng() > 0.5 ? 1 : -1) * (0.03 + rng() * 0.05)
        // 随机丢束
        if (rng() < 0.001) ttw = -1
      }
      const o = inChunk * N_BEAM + b
      angles[o] = beta
      tts[o] = ttw
    }
    inChunk++
  }
  flush()
  const line: SurveyLine = {
    id: lineId,
    voyageId,
    name: spec.name,
    pingCount: nPing,
    nBeams: N_BEAM,
    chunkCount: chunks.length,
    createdAt: t0,
  }
  return { line, chunks }
}
