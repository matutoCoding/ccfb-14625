// GPU 重算管线：组装缓冲区 → 分块 dispatch → 读回结果

import { getGpu } from "./device"
import { RECOMPUTE_WGSL } from "./shader"

export interface GpuLineInput {
  pings: Float32Array // 每 ping 8 浮点：e n heading pitch | roll heave tide castIdx
  beams: Float32Array // 每波束 2 浮点：angle ttw（ping 主序）
  layers: Float32Array // 每层 4 浮点：z0 z1 c0 g
  casts: Uint32Array // 每套剖面 4 个 u32：offset count 0 0（最多 8 套）
  nPings: number
  nBeams: number
  mounting: [number, number, number, number]
  lever: [number, number, number, number]
  sigmas: [number, number, number, number]
  trunc: [number, number, number, number]
}

let pipeline: GPUComputePipeline | null = null

export const recomputeGpu = async (inp: GpuLineInput): Promise<Float32Array | null> => {
  const dev = await getGpu()
  if (!dev) return null
  if (!pipeline) {
    const mod = dev.createShaderModule({ code: RECOMPUTE_WGSL })
    pipeline = dev.createComputePipeline({
      layout: "auto",
      compute: { module: mod, entryPoint: "main" },
    })
  }
  const mkBuf = (data: ArrayBufferView, usage: GPUBufferUsageFlags): GPUBuffer => {
    const buf = dev.createBuffer({ size: Math.max(16, data.byteLength), usage })
    dev.queue.writeBuffer(buf, 0, data.buffer, data.byteOffset, data.byteLength)
    return buf
  }
  const params = new Float32Array(16 + 32)
  params.set(inp.mounting, 0)
  params.set(inp.lever, 4)
  params.set(inp.sigmas, 8)
  params.set(inp.trunc, 12)
  const paramsU32 = new Uint32Array(params.buffer)
  paramsU32.set(inp.casts, 16)
  const dims = new Uint32Array([inp.nBeams, inp.nPings, inp.casts.length / 4, 0])
  const outSize = inp.nPings * inp.nBeams * 8 * 4
  const paramBuf = mkBuf(params, GPUBufferUsage.UNIFORM)
  const dimsBuf = mkBuf(dims, GPUBufferUsage.UNIFORM)
  const layerBuf = mkBuf(inp.layers, GPUBufferUsage.STORAGE)
  const pingBuf = mkBuf(inp.pings, GPUBufferUsage.STORAGE)
  const beamBuf = mkBuf(inp.beams, GPUBufferUsage.STORAGE)
  const outBuf = dev.createBuffer({ size: outSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })
  const bind = dev.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: paramBuf } },
      { binding: 1, resource: { buffer: dimsBuf } },
      { binding: 2, resource: { buffer: layerBuf } },
      { binding: 3, resource: { buffer: pingBuf } },
      { binding: 4, resource: { buffer: beamBuf } },
      { binding: 5, resource: { buffer: outBuf } },
    ],
  })
  const enc = dev.createCommandEncoder()
  const pass = enc.beginComputePass()
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bind)
  pass.dispatchWorkgroups(Math.ceil(inp.nBeams / 256), inp.nPings)
  pass.end()
  const stage = dev.createBuffer({ size: outSize, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  enc.copyBufferToBuffer(outBuf, 0, stage, 0, outSize)
  dev.queue.submit([enc.finish()])
  await stage.mapAsync(GPUMapMode.READ)
  const out = new Float32Array(outSize / 4)
  out.set(new Float32Array(stage.getMappedRange()))
  stage.unmap()
  for (const b of [paramBuf, dimsBuf, layerBuf, pingBuf, beamBuf, outBuf, stage]) b.destroy()
  return out
}
