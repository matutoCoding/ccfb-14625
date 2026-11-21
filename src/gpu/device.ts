// WebGPU 设备初始化，失败返回 null 走 CPU 回退

let cached: GPUDevice | null | undefined

export const getGpu = async (): Promise<GPUDevice | null> => {
  if (cached !== undefined) return cached
  try {
    if (!navigator.gpu) {
      cached = null
      return null
    }
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) {
      cached = null
      return null
    }
    cached = await adapter.requestDevice()
    return cached
  } catch {
    cached = null
    return null
  }
}

export const gpuInfo = async (): Promise<string> => {
  const dev = await getGpu()
  if (!dev) return "不可用（CPU 回退）"
  return "可用"
}
