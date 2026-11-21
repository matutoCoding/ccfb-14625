// 全局基础类型：ping、波束、声速剖面、姿态、安装偏差、水深点

export interface SvpPoint {
  z: number // 深度 m，向下为正
  c: number // 声速 m/s
}

export interface SvpProfile {
  id: string
  name: string
  time: number // CTD 投放时刻 unix ms
  lat: number
  lon: number
  points: SvpPoint[] // 按 z 升序
}

// 分层常梯度模型的一层
export interface SvpLayer {
  z0: number // 层顶深度
  z1: number // 层底深度
  c0: number // 层顶声速
  g: number // 梯度 (c1-c0)/(z1-z0)，等速层为 0
}

export interface Attitude {
  heading: number // 艏向 deg，北顺时针对
  pitch: number // 纵摇 deg，艏抬为正
  roll: number // 横摇 deg，右舷下沉为正
  heave: number // 升沉 m，向上为正
}

// 安装偏差角（patch test 求解对象）
export interface Mounting {
  roll: number
  pitch: number
  heading: number
  latency: number // 时延 s
}

export interface LeverArm {
  // 换能器相对 GPS 天线在船体系下的偏移，x 艏向 y 右舷 z 向下
  x: number
  y: number
  z: number
}

export interface PingHead {
  time: number // unix ms
  lat: number // GNSS 天线位置
  lon: number
  att: Attitude
  svpId: string // 自动匹配的最近剖面
  tideMissing: boolean // 潮位缺失标记，不参与成图
}

// 波束原始数据按列存 TypedArray，一块默认 1024 ping
export interface PingChunk {
  lineId: string
  startPing: number
  count: number
  heads: PingHead[]
  beamAngle: Float32Array // count * nBeams，相对换能器垂直方向的夹角 rad，右舷为正
  travelTime: Float32Array // 双程旅行时 s
}

// 解算后的水深点
export interface Sounding {
  e: number // 局部平面坐标 m
  n: number
  depth: number // 图深 m（已改正潮位/升沉/吃水）
  beam: number // 波束号
  ping: number
  across: number // 相对测线航向的横向距离
  sigma: number // 深度不确定度 m
}

export interface TideStation {
  id: string
  name: string
  lat: number
  lon: number
  times: Float64Array // unix ms，升序
  heights: Float32Array // 潮位 m，平均海面向上为正
}

export interface Voyage {
  id: string
  name: string
  createdAt: number
}

export interface SurveyLine {
  id: string
  voyageId: string
  name: string
  pingCount: number
  nBeams: number
  chunkCount: number
  createdAt: number
}

export const FLAG_OK = 0
export const FLAG_REJECTED = 1 // 清理标记，只打标不动原始数据
export const FLAG_NO_BOTTOM = 2 // 声线未到底（折射翻转/超界）
