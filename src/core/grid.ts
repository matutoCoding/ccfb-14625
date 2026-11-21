// 格网化：加权累计（Welford 方差），每格记点数/均值/标准差/合成不确定度，空格保持 NaN 不插值

export interface Grid {
  x0: number
  y0: number
  cell: number
  nx: number
  ny: number
  count: Uint32Array
  mean: Float64Array
  m2: Float64Array // 方差累计量
  wSum: Float64Array
  wSig2: Float64Array // Σw²σ² 累计，用于合成不确定度
}

export const makeGrid = (x0: number, y0: number, x1: number, y1: number, cell: number): Grid => {
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell))
  const ny = Math.max(1, Math.ceil((y1 - y0) / cell))
  const n = nx * ny
  return {
    x0, y0, cell, nx, ny,
    count: new Uint32Array(n),
    mean: new Float64Array(n),
    m2: new Float64Array(n),
    wSum: new Float64Array(n),
    wSig2: new Float64Array(n),
  }
}

// 入射角加权：w = cos²β，重叠区外侧波束自动降权
export const weightOf = (across: number, depth: number): number => {
  const r = Math.hypot(across, depth)
  if (r < 1e-6) return 1
  const cos = depth / r
  return cos * cos
}

export const addSounding = (g: Grid, e: number, n: number, depth: number, sigma: number, w: number): void => {
  const ix = Math.floor((e - g.x0) / g.cell)
  const iy = Math.floor((n - g.y0) / g.cell)
  if (ix < 0 || iy < 0 || ix >= g.nx || iy >= g.ny) return
  const i = iy * g.nx + ix
  const wNew = g.wSum[i]! + w
  const delta = depth - g.mean[i]!
  g.mean[i] = g.mean[i]! + w * delta / wNew
  g.m2[i] = g.m2[i]! + w * delta * (depth - g.mean[i]!)
  g.wSum[i] = wNew
  g.wSig2[i] = g.wSig2[i]! + w * w * sigma * sigma
  g.count[i] = g.count[i]! + 1
}

export const cellStd = (g: Grid, i: number): number => {
  const wSum = g.wSum[i]!
  if (g.count[i]! < 2 || wSum <= 0) return NaN
  return Math.sqrt(g.m2[i]! / wSum)
}

// 合成不确定度：sqrt(Σw²σ²)/Σw
export const cellUncertainty = (g: Grid, i: number): number => {
  const wSum = g.wSum[i]!
  if (wSum <= 0) return NaN
  return Math.sqrt(g.wSig2[i]!) / wSum
}

export const cellDepth = (g: Grid, i: number): number =>
  g.count[i]! > 0 ? g.mean[i]! : NaN
