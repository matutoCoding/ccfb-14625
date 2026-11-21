// 测线重算编排：潮位插值 → 剖面分层表 → GPU（或 CPU 回退）→ 标记合成 → 落库

import { georefBeam, type GeorefParams } from "@/core/georef"
import { buildLayers } from "@/core/ray_trace"
import { tideAt } from "@/core/tide"
import type { PingChunk, SvpProfile, SurveyLine, TideStation } from "@/core/types"
import { dbPut, STORES } from "@/db/db"
import { recomputeGpu } from "@/gpu/recompute_gpu"

export interface RecomputeSettings {
  georef: GeorefParams
  nadirCutDeg: number // 正下方截断角
  outerCutDeg: number // 外侧截断角
  tideToleranceMs: number
}

export interface RecomputeResult {
  elapsedMs: number
  beamCount: number
  usedGpu: boolean
  tideMissingPings: number
}

const MAX_CASTS = 8

// 整条测线重算，edits 为清理标记（1=剔除），结果写入 soundings store
export const recomputeLine = async (
  line: SurveyLine,
  chunks: PingChunk[],
  svpProfiles: SvpProfile[],
  tides: TideStation[],
  st: RecomputeSettings,
  edits: Uint8Array | undefined,
  onProgress?: (f: number) => void,
): Promise<RecomputeResult> => {
  const t0 = performance.now()
  // 剖面去重并编号
  const castIds: string[] = []
  const castLayers: ReturnType<typeof buildLayers>[] = []
  for (const c of chunks) {
    for (const h of c.heads) {
      if (!castIds.includes(h.svpId) && castIds.length < MAX_CASTS) {
        const prof = svpProfiles.find((p) => p.id === h.svpId)
        if (prof) {
          castIds.push(prof.id)
          castLayers.push(buildLayers(prof.points, 1000))
        }
      }
    }
  }
  const layerFlat: number[] = []
  const castTable = new Uint32Array(MAX_CASTS * 4)
  castLayers.forEach((ls, i) => {
    castTable[i * 4] = layerFlat.length / 4
    castTable[i * 4 + 1] = ls.length
    for (const L of ls) layerFlat.push(L.z0, L.z1, L.c0, L.g)
  })
  const layersArr = new Float32Array(Math.max(16, layerFlat.length))
  layersArr.set(layerFlat)
  let beamCount = 0
  let tideMissingPings = 0
  let usedGpu = false
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]!
    const nPing = chunk.count
    const nBeam = line.nBeams
    // 组 ping 缓冲：e n heading pitch | roll heave tide castIdx
    const pings = new Float32Array(nPing * 8)
    const tideMissing = new Uint8Array(nPing)
    for (let p = 0; p < nPing; p++) {
      const h = chunk.heads[p]!
      const en = toLocalSafe(st.georef.origin, h.lat, h.lon)
      const tide = tideAt(tides, st.georef.origin, h.lat, h.lon, h.time, st.tideToleranceMs)
      if (tide.missing) {
        tideMissing[p] = 1
        tideMissingPings++
        h.tideMissing = true
      } else {
        h.tideMissing = false
      }
      const o = p * 8
      pings[o] = en.e
      pings[o + 1] = en.n
      pings[o + 2] = h.att.heading
      pings[o + 3] = h.att.pitch
      pings[o + 4] = h.att.roll
      pings[o + 5] = h.att.heave
      pings[o + 6] = tide.height
      pings[o + 7] = Math.max(0, castIds.indexOf(h.svpId))
    }
    let out: Float32Array | null = null
    if (castLayers.length > 0) {
      out = await recomputeGpu({
        pings,
        beams: interleave(chunk.beamAngle, chunk.travelTime),
        layers: layersArr,
        casts: castTable,
        nPings: nPing,
        nBeams: nBeam,
        mounting: [st.georef.mounting.roll, st.georef.mounting.pitch, st.georef.mounting.heading, st.georef.mounting.latency],
        lever: [st.georef.lever.x, st.georef.lever.y, st.georef.lever.z, st.georef.draft],
        sigmas: [st.georef.sigmaTide, st.georef.sigmaHeave, st.georef.sigmaRollDeg, st.georef.sigmaSound],
        trunc: [st.nadirCutDeg, st.outerCutDeg, 0, 0],
      })
    }
    if (out) {
      usedGpu = true
    } else {
      out = recomputeCpu(chunk, nPing, nBeam, castIds, castLayers, tides, st)
    }
    // 合成标记：潮位缺测 + 清理剔除
    const nBeamsTotal = nPing * nBeam
    for (let p = 0; p < nPing; p++) {
      for (let b = 0; b < nBeam; b++) {
        const i = p * nBeam + b
        const fo = i * 8 + 5
        let flag = out[fo]!
        if (flag === 0 && tideMissing[p] === 1) flag = 4
        if (edits && edits[chunk.startPing + i] === 1 && flag === 0) flag = 1
        out[fo] = flag
      }
    }
    beamCount += nBeamsTotal
    await dbPut(STORES.soundings, out.buffer, [line.id, ci])
    onProgress?.((ci + 1) / chunks.length)
  }
  return { elapsedMs: performance.now() - t0, beamCount, usedGpu, tideMissingPings }
}

const interleave = (a: Float32Array, b: Float32Array): Float32Array => {
  const out = new Float32Array(a.length * 2)
  for (let i = 0; i < a.length; i++) {
    out[i * 2] = a[i]!
    out[i * 2 + 1] = b[i]!
  }
  return out
}

const toLocalSafe = (origin: GeorefParams["origin"], lat: number, lon: number) => {
  // 与 GPU 端一致：局部平面投影
  const e = (lon - origin.lon0) * origin.mPerDegLon
  const n = (lat - origin.lat0) * origin.mPerDegLat
  return { e, n }
}

// CPU 回退路径：逐波束调 georefBeam
const recomputeCpu = (
  chunk: PingChunk,
  nPing: number,
  nBeam: number,
  castIds: string[],
  castLayers: ReturnType<typeof buildLayers>[],
  tides: TideStation[],
  st: RecomputeSettings,
): Float32Array => {
  const out = new Float32Array(nPing * nBeam * 8)
  for (let p = 0; p < nPing; p++) {
    const h = chunk.heads[p]!
    const castIdx = Math.max(0, castIds.indexOf(h.svpId))
    const layers = castLayers[castIdx]
    const tide = tideAt(tides, st.georef.origin, h.lat, h.lon, h.time, st.tideToleranceMs)
    for (let b = 0; b < nBeam; b++) {
      const i = p * nBeam + b
      const o = i * 8
      const beta = chunk.beamAngle[i]!
      const ttw = chunk.travelTime[i]!
      const betaDeg = Math.abs(beta) * 180 / Math.PI
      if (betaDeg < st.nadirCutDeg || betaDeg > st.outerCutDeg) {
        out[o + 5] = 3
        continue
      }
      if (ttw <= 0 || !layers) {
        out[o + 5] = 2
        continue
      }
      const hit = georefBeam(layers, h.lat, h.lon, h.att, beta, ttw, tide.height, st.georef)
      if (!hit.ok) {
        out[o + 5] = 2
        continue
      }
      out[o] = hit.e
      out[o + 1] = hit.n
      out[o + 2] = hit.depth
      out[o + 3] = hit.across
      out[o + 4] = hit.sigma
    }
  }
  return out
}
