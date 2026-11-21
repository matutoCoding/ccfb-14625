// 晕渲 + 深度色带：输出 RGBA 像素，空格透明

import { cellDepth, type Grid } from "./grid"

// 深度色带：浅→深 青→蓝→深蓝黑
export const depthColor = (t: number): [number, number, number] => {
  const stops: [number, [number, number, number]][] = [
    [0.0, [178, 235, 242]],
    [0.25, [77, 182, 214]],
    [0.5, [33, 113, 181]],
    [0.75, [20, 60, 130]],
    [1.0, [8, 29, 88]],
  ]
  const x = Math.min(1, Math.max(0, t))
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]!
    const [t1, c1] = stops[i + 1]!
    if (x >= t0 && x <= t1) {
      const k = (x - t0) / (t1 - t0)
      return [
        c0[0] + (c1[0] - c0[0]) * k,
        c0[1] + (c1[1] - c0[1]) * k,
        c0[2] + (c1[2] - c0[2]) * k,
      ]
    }
  }
  return stops[stops.length - 1]![1]
}

export interface RenderOptions {
  zMin: number
  zMax: number
  hillshade: boolean
  azimuthDeg?: number
  altitudeDeg?: number
}

export const renderGrid = (g: Grid, opt: RenderOptions): ImageData => {
  const { nx, ny } = g
  const img = new ImageData(nx, ny)
  const az = (opt.azimuthDeg ?? 315) * Math.PI / 180
  const alt = (opt.altitudeDeg ?? 45) * Math.PI / 180
  const depthAt = (ix: number, iy: number): number => {
    const x = Math.min(nx - 1, Math.max(0, ix))
    const y = Math.min(ny - 1, Math.max(0, iy))
    return cellDepth(g, y * nx + x)
  }
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const d = cellDepth(g, iy * nx + ix)
      const o = (iy * nx + ix) * 4
      if (!Number.isFinite(d)) {
        img.data[o + 3] = 0
        continue
      }
      const t = (d - opt.zMin) / Math.max(opt.zMax - opt.zMin, 1e-9)
      const [r, gg, b] = depthColor(t)
      let shade = 1
      if (opt.hillshade) {
        const dzdx = (depthAt(ix + 1, iy) - depthAt(ix - 1, iy)) / (2 * g.cell)
        const dzdy = (depthAt(ix, iy + 1) - depthAt(ix, iy - 1)) / (2 * g.cell)
        if (Number.isFinite(dzdx) && Number.isFinite(dzdy)) {
          const slope = Math.atan(Math.hypot(dzdx, dzdy))
          const aspect = Math.atan2(dzdy, -dzdx)
          shade = Math.sin(alt) * Math.cos(slope) +
            Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect)
          shade = 0.55 + 0.45 * Math.max(0, shade)
        }
      }
      img.data[o] = r * shade
      img.data[o + 1] = gg * shade
      img.data[o + 2] = b * shade
      img.data[o + 3] = 255
    }
  }
  return img
}
