// 姿态旋转：船体系(x艏/y右舷/z下) → NED 导航系，R = Rz(艏向)·Ry(纵摇)·Rx(横摇)

export type Vec3 = [number, number, number]
export type Mat3 = [number, number, number, number, number, number, number, number, number]

const D2R = Math.PI / 180

export const rotX = (deg: number): Mat3 => {
  const c = Math.cos(deg * D2R)
  const s = Math.sin(deg * D2R)
  return [1, 0, 0, 0, c, -s, 0, s, c]
}

export const rotY = (deg: number): Mat3 => {
  const c = Math.cos(deg * D2R)
  const s = Math.sin(deg * D2R)
  return [c, 0, s, 0, 1, 0, -s, 0, c]
}

export const rotZ = (deg: number): Mat3 => {
  const c = Math.cos(deg * D2R)
  const s = Math.sin(deg * D2R)
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}

export const matMul = (a: Mat3, b: Mat3): Mat3 => {
  const o = new Array<number>(9)
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      o[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!
  return o as Mat3
}

export const matVec = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
]

// 姿态矩阵：船体系 → NED
export const attitudeMat = (heading: number, pitch: number, roll: number): Mat3 =>
  matMul(rotZ(heading), matMul(rotY(pitch), rotX(roll)))

// 安装偏差矩阵（小角度，顺序固定 Rz·Ry·Rx 并写入文档约定）
export const mountingMat = (heading: number, pitch: number, roll: number): Mat3 =>
  matMul(rotZ(heading), matMul(rotY(pitch), rotX(roll)))
