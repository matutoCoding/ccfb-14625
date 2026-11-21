// 测试航次生成：组装测线计划、CTD 投放、验潮站（含缺测段），驱动逐线生成

import { makeOrigin, toGeo, type LocalOrigin } from "@/core/geodesy"
import type { Mounting, SvpProfile, SurveyLine, TideStation, Voyage, PingChunk } from "@/core/types"
import { genLine } from "./generate_line"

// 可复现随机数
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 安装偏差真值（校准页用来对照求解结果）
export const TRUE_MOUNTING: Mounting = { roll: 1.3, pitch: -0.8, heading: 0.6, latency: 0 }
// 杆臂：换能器相对 GNSS 天线（船体系 x艏/y右舷/z下）
export const LEVER = { x: -2.0, y: -0.5, z: 3.0 }
export const DRAFT = 4.0
export const ORIGIN: LocalOrigin = makeOrigin(30, 122)

export interface LineSpec {
  name: string
  e: number
  n0: number
  n1: number
  heading: number
  speedKn: number
  kind: "survey" | "patch_roll" | "patch_pitch" | "patch_heading"
}

export const defaultLinePlan = (): LineSpec[] => [
  { name: "S1", e: 1800, n0: 600, n1: 3200, heading: 0, speedKn: 5, kind: "survey" },
  { name: "S2", e: 2000, n0: 600, n1: 3200, heading: 180, speedKn: 5, kind: "survey" },
  { name: "S3", e: 2200, n0: 600, n1: 3200, heading: 0, speedKn: 5, kind: "survey" },
  { name: "S4", e: 2400, n0: 600, n1: 3200, heading: 180, speedKn: 5, kind: "survey" },
  { name: "S5", e: 2600, n0: 600, n1: 3200, heading: 0, speedKn: 5, kind: "survey" },
  { name: "PT_ROLL_A", e: 500, n0: 200, n1: 1500, heading: 0, speedKn: 5, kind: "patch_roll" },
  { name: "PT_ROLL_B", e: 500, n0: 200, n1: 1500, heading: 180, speedKn: 5, kind: "patch_roll" },
  { name: "PT_PITCH_A", e: 1500, n0: 1200, n1: 2800, heading: 0, speedKn: 5, kind: "patch_pitch" },
  { name: "PT_PITCH_B", e: 1500, n0: 1200, n1: 2800, heading: 0, speedKn: 7, kind: "patch_pitch" },
  { name: "PT_HDG_A", e: 1650, n0: 1200, n1: 2800, heading: 0, speedKn: 5, kind: "patch_heading" },
  { name: "PT_HDG_B", e: 1650, n0: 1200, n1: 2800, heading: 180, speedKn: 5, kind: "patch_heading" },
]

export interface GeneratedVoyage {
  voyage: Voyage
  lines: { line: SurveyLine; chunks: PingChunk[] }[]
  svp: SvpProfile[]
  tides: TideStation[]
}

// 真实声速剖面（含温跃层），每次投放带小扰动
const baseSvp = (rng: () => number): { z: number; c: number }[] => {
  const off = (rng() - 0.5) * 3
  return [
    { z: 0, c: 1534 + off },
    { z: 10, c: 1532 + off },
    { z: 25, c: 1519 + off * 0.6 },
    { z: 50, c: 1504 },
    { z: 80, c: 1495 },
    { z: 120, c: 1491 },
    { z: 200, c: 1494 },
    { z: 300, c: 1499 },
  ]
}

const mkTide = (
  id: string, nm: string, lat: number, lon: number,
  amp: number, phaseH: number,
  gapStartH: number, gapEndH: number,
  t0: number,
): TideStation => {
  const times: number[] = []
  const heights: number[] = []
  for (let k = 0; k <= 24 * 12; k++) {
    const t = t0 - 2 * 3600_000 + k * 300_000
    const hRel = (t - t0) / 3600_000
    if (hRel > gapStartH && hRel < gapEndH) continue
    times.push(t)
    const h = amp * Math.sin(2 * Math.PI * (t / 3600_000 - phaseH) / 12.42) +
      0.35 * Math.sin(2 * Math.PI * (t / 3600_000) / 24)
    heights.push(h)
  }
  return { id, name: nm, lat, lon, times: new Float64Array(times), heights: new Float32Array(heights) }
}

// 分块异步生成，onProgress 回报 0..1
export const generateVoyage = async (
  name: string,
  onProgress: (f: number, label: string) => void,
  withBenchLine = false,
): Promise<GeneratedVoyage> => {
  const rng = mulberry32(20261122)
  const voyageId = `v_${Date.now().toString(36)}`
  const t0 = Date.now()
  // 声速剖面投放：每 2 小时一次，位置散布测区
  const svp: SvpProfile[] = []
  for (let i = 0; i < 6; i++) {
    const e = 1000 + rng() * 2000
    const n = 800 + rng() * 2400
    const geo = toGeo(ORIGIN, e, n)
    svp.push({
      id: `svp_${voyageId}_${i}`,
      name: `CTD-${String(i + 1).padStart(2, "0")}`,
      time: t0 + i * 2 * 3600_000,
      lat: geo.lat,
      lon: geo.lon,
      points: baseSvp(rng),
    })
  }
  // 验潮站：两站缺测窗口错开，6-8h 两站都缺 → 该段 ping 标缺测
  const tides = [
    mkTide(`t_${voyageId}_1`, "验潮站-主港", 30.0, 122.0, 1.6, 2.1, 6, 8, t0),
    mkTide(`t_${voyageId}_2`, "验潮站-外锚地", 30.08, 122.05, 1.5, 2.4, 5, 9, t0),
  ]
  const plan = defaultLinePlan()
  if (withBenchLine) plan.push({ name: "BENCH_20K", e: 3000, n0: 0, n1: 25700, heading: 0, speedKn: 5, kind: "survey" })
  const lines: GeneratedVoyage["lines"] = []
  for (let li = 0; li < plan.length; li++) {
    onProgress(li / plan.length, `生成测线 ${plan[li]!.name}`)
    lines.push(await genLine(voyageId, plan[li]!, svp, t0, rng, li))
  }
  onProgress(1, "完成")
  return { voyage: { id: voyageId, name, createdAt: t0 }, lines, svp, tides }
}
