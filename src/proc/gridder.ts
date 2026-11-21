// 格网化编排：从 soundings 库读解算结果，叠加清理标记，按入射角加权累计成 DEM

import { addSounding, makeGrid, weightOf, type Grid } from "@/core/grid"
import { dbGet, STORES } from "@/db/db"
import type { SurveyLine } from "@/core/types"

export interface GridResult {
  grid: Grid
  usedPoints: number
  elapsedMs: number
}

interface LineChunks {
  arrs: Float32Array[]
  edits: Uint8Array | undefined
  nBeam: number
}

const loadLineChunks = async (line: SurveyLine): Promise<LineChunks> => {
  const arrs: Float32Array[] = []
  for (let ci = 0; ci < line.chunkCount; ci++) {
    const buf = await dbGet<ArrayBuffer>(STORES.soundings, [line.id, ci])
    if (buf) arrs.push(new Float32Array(buf))
  }
  const edits = await dbGet<Uint8Array>(STORES.edits, line.id)
  return { arrs, edits, nBeam: line.nBeams }
}

// 遍历一条线的有效点（flag==0 且未被清理剔除）
const forEachPoint = (lc: LineChunks, fn: (e: number, n: number, depth: number, across: number, sigma: number) => void): void => {
  let pingOff = 0
  for (const arr of lc.arrs) {
    const nBeam = lc.nBeam
    const chunkPings = arr.length / 8 / nBeam
    for (let i = 0; i < arr.length; i += 8) {
      if (arr[i + 5] !== 0) continue
      const localPing = Math.floor(i / 8 / nBeam)
      const beam = (i / 8) % nBeam
      const gi = (pingOff + localPing) * nBeam + beam
      if (lc.edits && lc.edits[gi] === 1) continue
      fn(arr[i]!, arr[i + 1]!, arr[i + 2]!, arr[i + 3]!, arr[i + 4]!)
    }
    pingOff += chunkPings
  }
}

// 多条测线合并成图；overlapWeight=false 时权重恒 1
export const gridLines = async (
  lines: SurveyLine[],
  cell: number,
  overlapWeight: boolean,
  bounds?: { x0: number; y0: number; x1: number; y1: number },
): Promise<GridResult> => {
  const t0 = performance.now()
  const loaded = await Promise.all(lines.map(loadLineChunks))
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const lc of loaded) {
    forEachPoint(lc, (e, n) => {
      if (e < x0) x0 = e
      if (e > x1) x1 = e
      if (n < y0) y0 = n
      if (n > y1) y1 = n
    })
  }
  if (bounds) {
    x0 = bounds.x0
    y0 = bounds.y0
    x1 = bounds.x1
    y1 = bounds.y1
  }
  if (!Number.isFinite(x0)) {
    return { grid: makeGrid(0, 0, 1, 1, cell), usedPoints: 0, elapsedMs: 0 }
  }
  const grid = makeGrid(x0, y0, x1, y1, cell)
  let used = 0
  for (const lc of loaded) {
    forEachPoint(lc, (e, n, depth, across, sigma) => {
      const w = overlapWeight ? weightOf(across, depth) : 1
      addSounding(grid, e, n, depth, sigma, w)
      used++
    })
  }
  return { grid, usedPoints: used, elapsedMs: performance.now() - t0 }
}
