// 等深线：marching squares，含 NaN 的格子跳过（空格不插值原则一致）

import type { Grid } from "./grid"
import { cellDepth } from "./grid"

export interface ContourSegment {
  x0: number
  y0: number
  x1: number
  y1: number
  level: number
}

const interp = (v0: number, v1: number, level: number): number =>
  (level - v0) / (v1 - v0)

export const contourLevel = (g: Grid, level: number): ContourSegment[] => {
  const segs: ContourSegment[] = []
  const at = (ix: number, iy: number) => cellDepth(g, iy * g.nx + ix)
  for (let iy = 0; iy < g.ny - 1; iy++) {
    for (let ix = 0; ix < g.nx - 1; ix++) {
      const v = [at(ix, iy), at(ix + 1, iy), at(ix + 1, iy + 1), at(ix, iy + 1)]
      if (v.some((x) => !Number.isFinite(x))) continue
      const x0 = g.x0 + ix * g.cell
      const y0 = g.y0 + iy * g.cell
      const c = g.cell
      // 角点: 0左上 1右上 2右下 3左下；边点按线性插值
      const pt = (edge: number): [number, number] => {
        switch (edge) {
          case 0: return [x0 + c * interp(v[0]!, v[1]!, level), y0] // 上边
          case 1: return [x0 + c, y0 + c * interp(v[1]!, v[2]!, level)] // 右边
          case 2: return [x0 + c * interp(v[3]!, v[2]!, level), y0 + c] // 下边
          case 3: return [x0, y0 + c * interp(v[0]!, v[3]!, level)] // 左边
          default: return [0, 0]
        }
      }
      let idx = 0
      for (let k = 0; k < 4; k++) if (v[k]! >= level) idx |= 1 << k
      if (idx === 0 || idx === 15) continue
      // 查表：每种情形连接的边
      const table: Record<number, [number, number][]> = {
        1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]],
        5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]],
        8: [[2, 3]], 9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[1, 2]],
        12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]],
      }
      for (const [e0, e1] of table[idx] ?? []) {
        const [ax, ay] = pt(e0)
        const [bx, by] = pt(e1)
        segs.push({ x0: ax, y0: ay, x1: bx, y1: by, level })
      }
    }
  }
  return segs
}

// 按间距自动抽等深线级别：深度范围 / 目标条数取整到 1/2/5 序列
export const autoLevels = (zMin: number, zMax: number, target = 12): number[] => {
  const raw = (zMax - zMin) / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10
  const s = step * mag
  const levels: number[] = []
  for (let v = Math.ceil(zMin / s) * s; v <= zMax; v += s) levels.push(Math.round(v * 1000) / 1000)
  return levels
}
