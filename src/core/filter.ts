// 条带自动滤波：沿航向滑动窗口拟合中位数面，残差超 nσ 的波束打异常标记

// 一维中位数滤波（奇数窗口）
export const medianFilter = (v: Float64Array, win: number): Float64Array => {
  const n = v.length
  const half = (win - 1) >> 1
  const out = new Float64Array(n)
  const buf: number[] = []
  for (let i = 0; i < n; i++) {
    buf.length = 0
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) buf.push(v[j]!)
    buf.sort((a, b) => a - b)
    out[i] = buf[buf.length >> 1]!
  }
  return out
}

export interface FilterResult {
  flags: Uint8Array // 1 = 异常
  residual: Float64Array
  sigma: Float64Array // 每波束列的稳健标准差
}

// depths: nPing × nBeam 行主序，NaN 表示无效点
export const swathFilter = (depths: Float64Array, nPing: number, nBeam: number, win: number, nSigma: number): FilterResult => {
  const flags = new Uint8Array(nPing * nBeam)
  const residual = new Float64Array(nPing * nBeam).fill(NaN)
  const sigma = new Float64Array(nBeam)
  const col = new Float64Array(nPing)
  for (let b = 0; b < nBeam; b++) {
    for (let p = 0; p < nPing; p++) col[p] = depths[p * nBeam + b]!
    // NaN 列直接跳过
    let valid = 0
    for (let p = 0; p < nPing; p++) if (Number.isFinite(col[p]!)) valid++
    if (valid < win) continue
    const med = medianFilter(col, win)
    // 稳健标准差：残差绝对值中位数 × 1.4826
    const absRes: number[] = []
    for (let p = 0; p < nPing; p++) {
      const r = col[p]! - med[p]!
      residual[p * nBeam + b] = r
      if (Number.isFinite(r)) absRes.push(Math.abs(r))
    }
    absRes.sort((a, b) => a - b)
    const mad = absRes.length > 0 ? absRes[absRes.length >> 1]! : 0
    const s = Math.max(mad * 1.4826, 1e-3)
    sigma[b] = s
    for (let p = 0; p < nPing; p++) {
      const r = residual[p * nBeam + b]!
      if (Number.isFinite(r) && Math.abs(r) > nSigma * s) flags[p * nBeam + b] = 1
    }
  }
  return { flags, residual, sigma }
}
