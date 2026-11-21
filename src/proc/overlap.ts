// 内符合检查：两条测线各自格网化后，重叠格深度差统计

import { cellDepth, makeGrid, addSounding, weightOf } from "@/core/grid"
import { dbGet, STORES } from "@/db/db"
import type { SurveyLine } from "@/core/types"

export interface OverlapStats {
  cells: number
  meanDiff: number
  stdDiff: number
  rmsDiff: number
  maxAbsDiff: number
}

const gridOneLine = async (line: SurveyLine, cell: number): Promise<{ x0: number; y0: number; nx: number; ny: number; cell: number; mean: Float64Array; count: Uint32Array } | null> => {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const arrs: Float32Array[] = []
  for (let ci = 0; ci < line.chunkCount; ci++) {
    const buf = await dbGet<ArrayBuffer>(STORES.soundings, [line.id, ci])
    if (!buf) continue
    const arr = new Float32Array(buf)
    arrs.push(arr)
    for (let i = 0; i < arr.length; i += 8) {
      if (arr[i + 5] !== 0) continue
      x0 = Math.min(x0, arr[i]!)
      x1 = Math.max(x1, arr[i]!)
      y0 = Math.min(y0, arr[i + 1]!)
      y1 = Math.max(y1, arr[i + 1]!)
    }
  }
  if (arrs.length === 0) return null
  const g = makeGrid(x0, y0, x1, y1, cell)
  for (const arr of arrs) {
    for (let i = 0; i < arr.length; i += 8) {
      if (arr[i + 5] !== 0) continue
      const w = weightOf(arr[i + 3]!, arr[i + 2]!)
      addSounding(g, arr[i]!, arr[i + 1]!, arr[i + 2]!, arr[i + 4]!, w)
    }
  }
  return { x0: g.x0, y0: g.y0, nx: g.nx, ny: g.ny, cell: g.cell, mean: g.mean, count: g.count }
}

export const overlapCheck = async (a: SurveyLine, b: SurveyLine, cell: number): Promise<OverlapStats | null> => {
  const ga = await gridOneLine(a, cell)
  const gb = await gridOneLine(b, cell)
  if (!ga || !gb) return null
  // 共同范围
  const x0 = Math.max(ga.x0, gb.x0)
  const y0 = Math.max(ga.y0, gb.y0)
  const x1 = Math.min(ga.x0 + ga.nx * cell, gb.x0 + gb.nx * cell)
  const y1 = Math.min(ga.y0 + ga.ny * cell, gb.y0 + gb.ny * cell)
  if (x1 <= x0 || y1 <= y0) return null
  const diffs: number[] = []
  for (let y = y0; y < y1; y += cell) {
    for (let x = x0; x < x1; x += cell) {
      const ia = Math.floor((y - ga.y0) / cell) * ga.nx + Math.floor((x - ga.x0) / cell)
      const ib = Math.floor((y - gb.y0) / cell) * gb.nx + Math.floor((x - gb.x0) / cell)
      if (ga.count[ia]! > 0 && gb.count[ib]! > 0) {
        diffs.push(ga.mean[ia]! - gb.mean[ib]!)
      }
    }
  }
  if (diffs.length === 0) return null
  const mean = diffs.reduce((s, v) => s + v, 0) / diffs.length
  const varc = diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / diffs.length
  const rms = Math.sqrt(diffs.reduce((s, v) => s + v * v, 0) / diffs.length)
  const maxAbs = diffs.reduce((s, v) => Math.max(s, Math.abs(v)), 0)
  return { cells: diffs.length, meanDiff: mean, stdDiff: Math.sqrt(varc), rmsDiff: rms, maxAbsDiff: maxAbs }
}
