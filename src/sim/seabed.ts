// 测试海底模型：缓坡 + 海山 + 沟槽 + 沉船，返回基准面以下深度 m

export interface Wreck {
  e: number
  n: number
  length: number // 船长 m
  width: number
  height: number // 高出海底 m
  headingDeg: number
}

export const WRECK: Wreck = { e: 2600, n: 1200, length: 78, width: 12, height: 9, headingDeg: 30 }

const SEAMOUNT = { e: 1500, n: 2000, r: 600, h: 80 } // 海山：高斯丘
const TRENCH = { e0: 500, n0: 3500, e1: 4500, n1: 1500, w: 250, d: 55 } // 沟槽：沿线负高斯

// 点到线段距离
const segDist = (e: number, n: number): number => {
  const dx = TRENCH.e1 - TRENCH.e0
  const dy = TRENCH.n1 - TRENCH.n0
  const len2 = dx * dx + dy * dy
  const t = Math.max(0, Math.min(1, ((e - TRENCH.e0) * dx + (n - TRENCH.n0) * dy) / len2))
  const px = TRENCH.e0 + t * dx
  const py = TRENCH.n0 + t * dy
  return Math.hypot(e - px, n - py)
}

export const seabedDepth = (e: number, n: number): number => {
  // 基准 120m + 缓坡 + 微起伏
  let d = 120 + 0.004 * e - 0.002 * n + 2.5 * Math.sin(e / 400) * Math.cos(n / 350)
  // 海山（向上凸起 = 深度减小）
  const r2m = ((e - SEAMOUNT.e) ** 2 + (n - SEAMOUNT.n) ** 2) / (SEAMOUNT.r * SEAMOUNT.r)
  d -= SEAMOUNT.h * Math.exp(-2.5 * r2m)
  // 沟槽（深度加大）
  const dt = segDist(e, n)
  d += TRENCH.d * Math.exp(-2 * (dt / TRENCH.w) ** 2)
  // 沉船：旋转矩形范围内抬高
  const a = WRECK.headingDeg * Math.PI / 180
  const de = e - WRECK.e
  const dn = n - WRECK.n
  const u = de * Math.cos(a) + dn * Math.sin(a) // 沿船向
  const v = -de * Math.sin(a) + dn * Math.cos(a)
  if (Math.abs(u) < WRECK.length / 2 && Math.abs(v) < WRECK.width / 2) {
    const hull = WRECK.height * (0.75 + 0.25 * Math.cos((u / (WRECK.length / 2)) * Math.PI / 2))
    d -= hull
  }
  return Math.max(d, 8)
}

// 平坦区（patch test 横摇用）：测区西侧一块近似平地
export const FLAT_AREA = { e: 500, n: 500 }
