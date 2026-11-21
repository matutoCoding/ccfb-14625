// IHO S-44 测深等级：总垂直不确定度 TVU = sqrt(a² + (b·d)²)，覆盖率与点密度检查

import { cellDepth, cellUncertainty, type Grid } from "./grid"

export type IhoOrder = "special" | "order1a"

export const IHO_PARAMS: Record<IhoOrder, { a: number; b: number; minPoints: number; label: string }> = {
  special: { a: 0.25, b: 0.0075, minPoints: 1, label: "特等" },
  order1a: { a: 0.5, b: 0.013, minPoints: 1, label: "一等" },
}

export const tvuLimit = (order: IhoOrder, depth: number): number => {
  const p = IHO_PARAMS[order]
  return Math.sqrt(p.a ** 2 + (p.b * depth) ** 2)
}

export interface CellCheck {
  pass: boolean
  reason: "" | "empty" | "density" | "tvu"
}

export const checkCell = (g: Grid, i: number, order: IhoOrder, minPoints: number): CellCheck => {
  const cnt = g.count[i]!
  if (cnt === 0) return { pass: false, reason: "empty" }
  if (cnt < minPoints) return { pass: false, reason: "density" }
  const d = cellDepth(g, i)
  const u = cellUncertainty(g, i)
  if (!(u <= tvuLimit(order, d))) return { pass: false, reason: "tvu" }
  return { pass: true, reason: "" }
}

export interface CoverageReport {
  total: number
  covered: number
  passed: number
  failedEmpty: number
  failedDensity: number
  failedTvu: number
  coveragePct: number
  passPct: number
  failMask: Uint8Array // 1 = 未达标格
}

export const coverageReport = (g: Grid, order: IhoOrder, minPoints: number): CoverageReport => {
  const n = g.nx * g.ny
  const failMask = new Uint8Array(n)
  let covered = 0
  let passed = 0
  let failedEmpty = 0
  let failedDensity = 0
  let failedTvu = 0
  for (let i = 0; i < n; i++) {
    const r = checkCell(g, i, order, minPoints)
    if (g.count[i]! > 0) covered++
    if (r.pass) {
      passed++
    } else {
      failMask[i] = 1
      if (r.reason === "empty") failedEmpty++
      else if (r.reason === "density") failedDensity++
      else failedTvu++
    }
  }
  return {
    total: n,
    covered,
    passed,
    failedEmpty,
    failedDensity,
    failedTvu,
    coveragePct: (100 * covered) / n,
    passPct: (100 * passed) / n,
    failMask,
  }
}

export interface ResurveyLine {
  x0: number
  y0: number
  x1: number
  y1: number
  failCount: number
}

// 补测建议：把未达标格按行聚成连续段，输出为建议测线（沿未达标带走向取主轴）
export const suggestResurvey = (g: Grid, failMask: Uint8Array, minLen = 3): ResurveyLine[] => {
  const lines: ResurveyLine[] = []
  for (let iy = 0; iy < g.ny; iy++) {
    let run = -1
    for (let ix = 0; ix <= g.nx; ix++) {
      const fail = ix < g.nx && failMask[iy * g.nx + ix] === 1
      if (fail && run < 0) run = ix
      if (!fail && run >= 0) {
        if (ix - run >= minLen) {
          lines.push({
            x0: g.x0 + run * g.cell,
            y0: g.y0 + (iy + 0.5) * g.cell,
            x1: g.x0 + ix * g.cell,
            y1: g.y0 + (iy + 0.5) * g.cell,
            failCount: ix - run,
          })
        }
        run = -1
      }
    }
  }
  // 纵向同样扫一遍，取走向更合理的一批（简单起见两方向都给出，长的优先）
  for (let ix = 0; ix < g.nx; ix++) {
    let run = -1
    for (let iy = 0; iy <= g.ny; iy++) {
      const fail = iy < g.ny && failMask[iy * g.nx + ix] === 1
      if (fail && run < 0) run = iy
      if (!fail && run >= 0) {
        if (iy - run >= minLen) {
          lines.push({
            x0: g.x0 + (ix + 0.5) * g.cell,
            y0: g.y0 + run * g.cell,
            x1: g.x0 + (ix + 0.5) * g.cell,
            y1: g.y0 + iy * g.cell,
            failCount: iy - run,
          })
        }
        run = -1
      }
    }
  }
  lines.sort((a, b) => b.failCount - a.failCount)
  return lines.slice(0, 10)
}
