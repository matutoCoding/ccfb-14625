// WGS84 局部平面投影：测区尺度下用子午线/卯酉圈曲率半径把经纬度换成米

const A = 6378137.0 // 长半轴
const E2 = 6.69437999014e-3 // 第一偏心率平方

const D2R = Math.PI / 180

export interface LocalOrigin {
  lat0: number
  lon0: number
  mPerDegLat: number
  mPerDegLon: number
}

export const makeOrigin = (lat0: number, lon0: number): LocalOrigin => {
  const sin = Math.sin(lat0 * D2R)
  const w = Math.sqrt(1 - E2 * sin * sin)
  const m = A * (1 - E2) / (w * w * w) // 子午圈半径
  const n = A / w // 卯酉圈半径
  return {
    lat0,
    lon0,
    mPerDegLat: m * D2R,
    mPerDegLon: n * Math.cos(lat0 * D2R) * D2R,
  }
}

export const toLocal = (o: LocalOrigin, lat: number, lon: number): { e: number; n: number } => ({
  e: (lon - o.lon0) * o.mPerDegLon,
  n: (lat - o.lat0) * o.mPerDegLat,
})

export const toGeo = (o: LocalOrigin, e: number, n: number): { lat: number; lon: number } => ({
  lat: o.lat0 + n / o.mPerDegLat,
  lon: o.lon0 + e / o.mPerDegLon,
})
