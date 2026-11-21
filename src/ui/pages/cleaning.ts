// 条带清理：三维点云框选 + 横截面逐 ping 检查 + 中位数/nσ 自动滤波，只打标不动原始数据

import { swathFilter } from "@/core/filter"
import type { SurveyLine } from "@/core/types"
import { dbGet, STORES } from "@/db/db"
import { loadEdits, saveEdits } from "@/proc/line_service"
import { el, emptyState, numField, ICONS } from "../ui"
import { state } from "../state"

interface LineData {
  pts: Float32Array // 拼接后的 soundings：每波束 8 浮点
  edits: Uint8Array
  nPing: number
  nBeam: number
}

const loadLineData = async (line: SurveyLine): Promise<LineData | null> => {
  const parts: Float32Array[] = []
  let total = 0
  for (let ci = 0; ci < line.chunkCount; ci++) {
    const buf = await dbGet<ArrayBuffer>(STORES.soundings, [line.id, ci])
    if (!buf) return null
    const a = new Float32Array(buf)
    parts.push(a)
    total += a.length
  }
  const pts = new Float32Array(total)
  let off = 0
  for (const p of parts) {
    pts.set(p, off)
    off += p.length
  }
  const edits = (await loadEdits(line)) ?? new Uint8Array(line.pingCount * line.nBeams)
  return { pts, edits, nPing: line.pingCount, nBeam: line.nBeams }
}

export const renderCleaning = (root: HTMLElement): void => {
  root.append(
    el("h2", { class: "page-title" }, ["条带清理"]),
    el("p", { class: "page-sub" }, ["三维点云框选删点、横截面逐 ping 检查、自动滤波；剔除只打标记，随时可恢复"]),
  )
  if (!state.voyage || state.lines.length === 0) {
    root.append(emptyState("未选择航次", "先到「航次管理」选择或生成航次", ICONS.clean))
    return
  }
  const lineSel = el("select", {}, state.lines.map((l) => el("option", { value: l.id }, [l.name]))) as HTMLSelectElement
  const status = el("span", { class: "tag" }, [""])
  const canvas = el("canvas", { width: 1100, height: 560 }) as HTMLCanvasElement
  const ctx = canvas.getContext("2d")!
  let line = state.lines[0]!
  let data: LineData | null = null
  let mode: "3d" | "section" = "3d"
  // 3D 视角状态
  let yaw = 0.6
  let pitch = 0.5
  let pingIdx = 0

  const countRejected = (): number => data ? data.edits.reduce((s, v) => s + (v === 1 ? 1 : 0), 0) : 0

  const updateStatus = () => {
    status.textContent = data ? `已剔除 ${countRejected()} 点（仅标记，可恢复）` : ""
  }

  // ---- 3D 视图 ----
  const draw3d = (selRect?: { x0: number; y0: number; x1: number; y1: number }) => {
    if (!data) return
    const { pts } = data
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)
    // 中心与范围
    let cx = 0, cy = 0, cz = 0, cnt = 0
    for (let i = 0; i < pts.length; i += 8 * 16) {
      if (pts[i + 5] !== 0 && data.edits[(i / 8) | 0] !== 1) continue
      cx += pts[i]!; cy += pts[i + 1]!; cz += pts[i + 2]!; cnt++
    }
    if (cnt === 0) return
    cx /= cnt; cy /= cnt; cz /= cnt
    const cyaw = Math.cos(yaw), syaw = Math.sin(yaw)
    const cpit = Math.cos(pitch), spit = Math.sin(pitch)
    const scale = Math.min(W, H) / 900
    const proj = (e: number, n: number, d: number): [number, number] => {
      const x0 = e - cx, y0 = n - cy, z0 = -(d - cz) * 3 // 深度夸张 3 倍
      const x1 = x0 * cyaw - y0 * syaw
      const y1 = x0 * syaw + y0 * cyaw
      const y2 = y1 * cpit - z0 * spit
      const z2 = y1 * spit + z0 * cpit
      return [W / 2 + x1 * scale, H / 2 - (y2 * 0.9 + z2 * 0.4) * scale]
    }
    const stride = Math.max(1, Math.floor(pts.length / 8 / 150000))
    for (let i = 0; i < pts.length; i += 8 * stride) {
      const bi = (i / 8) | 0
      const flagOk = pts[i + 5] === 0
      const rejected = data.edits[bi] === 1
      if (!flagOk && !rejected) continue
      const d = pts[i + 2]!
      const [px, py] = proj(pts[i]!, pts[i + 1]!, d)
      if (rejected) ctx.fillStyle = "rgba(220,38,38,0.5)"
      else {
        const t = Math.min(1, Math.max(0, (d - 40) / 160))
        ctx.fillStyle = `rgb(${Math.round(33 + t * 100)},${Math.round(113 - t * 60)},${Math.round(181 - t * 80)})`
      }
      ctx.fillRect(px, py, 1.6, 1.6)
    }
    if (selRect) {
      ctx.strokeStyle = "#1d6fd1"
      ctx.setLineDash([4, 3])
      ctx.strokeRect(selRect.x0, selRect.y0, selRect.x1 - selRect.x0, selRect.y1 - selRect.y0)
      ctx.setLineDash([])
    }
    ;(draw3d as unknown as { proj: typeof proj }).proj = proj
  }

  // ---- 横截面视图 ----
  const drawSection = () => {
    if (!data) return
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)
    const { pts, nBeam } = data
    const base = pingIdx * nBeam * 8
    const xs: number[] = []
    const ys: number[] = []
    for (let b = 0; b < nBeam; b++) {
      const o = base + b * 8
      if (pts[o + 5] !== 0 && data.edits[pingIdx * nBeam + b] !== 1) continue
      xs.push(pts[o + 3]!)
      ys.push(pts[o + 2]!)
    }
    if (xs.length === 0) return
    const x0 = Math.min(...xs), x1 = Math.max(...xs)
    const y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1
    const X = (v: number) => 50 + ((v - x0) / Math.max(x1 - x0, 1e-6)) * (W - 80)
    const Y = (v: number) => 24 + ((v - y0) / (y1 - y0)) * (H - 70)
    ctx.fillStyle = "#64748b"
    ctx.font = "12px sans-serif"
    ctx.fillText(`ping #${pingIdx} / ${data.nPing}`, 50, 16)
    ctx.fillText(y0.toFixed(1), 8, Y(y0) + 4)
    ctx.fillText(y1.toFixed(1), 8, Y(y1) + 4)
    for (let b = 0; b < nBeam; b++) {
      const o = base + b * 8
      const rejected = data.edits[pingIdx * nBeam + b] === 1
      if (pts[o + 5] !== 0 && !rejected) continue
      ctx.fillStyle = rejected ? "#dc2626" : "#1d6fd1"
      ctx.beginPath()
      ctx.arc(X(pts[o + 3]!), Y(pts[o + 2]!), 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ;(drawSection as unknown as { X: (v: number) => number }).X = X
  }

  const redraw = () => (mode === "3d" ? draw3d() : drawSection())

  // 交互：3D 拖动旋转 / 框选删除；横截面点击删点
  let dragStart: { x: number; y: number } | null = null
  let dragMode: "orbit" | "box" | null = null
  canvas.addEventListener("mousedown", (e) => {
    dragStart = { x: e.offsetX, y: e.offsetY }
    dragMode = e.shiftKey || mode === "section" ? "box" : "orbit"
  })
  canvas.addEventListener("mousemove", (e) => {
    if (!dragStart || !data) return
    if (dragMode === "orbit") {
      yaw += (e.offsetX - dragStart.x) * 0.008
      pitch = Math.max(0.1, Math.min(1.4, pitch + (e.offsetY - dragStart.y) * 0.005))
      dragStart = { x: e.offsetX, y: e.offsetY }
      draw3d()
    } else {
      draw3d({ x0: dragStart.x, y0: dragStart.y, x1: e.offsetX, y1: e.offsetY })
    }
  })
  canvas.addEventListener("mouseup", async (e) => {
    if (!dragStart || !data) {
      dragStart = null
      return
    }
    const rect = {
      x0: Math.min(dragStart.x, e.offsetX), y0: Math.min(dragStart.y, e.offsetY),
      x1: Math.max(dragStart.x, e.offsetX), y1: Math.max(dragStart.y, e.offsetY),
    }
    const isClick = rect.x1 - rect.x0 < 4 && rect.y1 - rect.y0 < 4
    if (mode === "3d" && dragMode === "box" && !isClick) {
      const proj = (draw3d as unknown as { proj: (e: number, n: number, d: number) => [number, number] }).proj
      const { pts } = data
      let n = 0
      for (let i = 0, bi = 0; i < pts.length; i += 8, bi++) {
        if (pts[i + 5] !== 0 || data.edits[bi] === 1) continue
        const [px, py] = proj(pts[i]!, pts[i + 1]!, pts[i + 2]!)
        if (px >= rect.x0 && px <= rect.x1 && py >= rect.y0 && py <= rect.y1) {
          data.edits[bi] = 1
          n++
        }
      }
      await saveEdits(line, data.edits)
      updateStatus()
      draw3d()
    } else if (mode === "section" && isClick) {
      // 点击最近波束切换剔除
      const X = (drawSection as unknown as { X: (v: number) => number }).X
      const { pts, nBeam } = data
      const base = pingIdx * nBeam * 8
      let best = -1
      let bestD = 20
      for (let b = 0; b < nBeam; b++) {
        const o = base + b * 8
        if (pts[o + 5] !== 0) continue
        const d = Math.abs(X(pts[o + 3]!) - e.offsetX)
        if (d < bestD) {
          bestD = d
          best = b
        }
      }
      if (best >= 0) {
        const bi = pingIdx * nBeam + best
        data.edits[bi] = data.edits[bi] === 1 ? 0 : 1
        await saveEdits(line, data.edits)
        updateStatus()
        drawSection()
      }
    }
    dragStart = null
    dragMode = null
  })

  const load = async () => {
    status.textContent = "加载中…"
    data = await loadLineData(line)
    if (!data) {
      status.textContent = "该测线尚未重算，请先到航次管理页重算"
      return
    }
    pingIdx = 0
    updateStatus()
    redraw()
  }
  lineSel.addEventListener("change", () => {
    line = state.lines.find((l) => l.id === lineSel.value)!
    void load()
  })

  // 工具栏
  const modeBtn = el("button", { class: "btn", onclick: () => {
    mode = mode === "3d" ? "section" : "3d"
    modeBtn.textContent = mode === "3d" ? "切到横截面" : "切到三维点云"
    redraw()
  } }, ["切到横截面"])
  const pingSlider = el("input", { type: "range", min: 0, max: line.pingCount - 1, value: 0, style: "width: 220px" }) as HTMLInputElement
  pingSlider.addEventListener("input", () => {
    pingIdx = Number(pingSlider.value)
    if (mode !== "section") {
      mode = "section"
      modeBtn.textContent = "切到三维点云"
    }
    drawSection()
  })
  // 自动滤波
  let winV = 7
  let sigV = 3
  const filterBtn = el("button", { class: "btn primary", onclick: async () => {
    if (!data) return
    const { pts, nPing, nBeam } = data
    const depths = new Float64Array(nPing * nBeam).fill(NaN)
    for (let i = 0, bi = 0; i < pts.length; i += 8, bi++) {
      if (pts[i + 5] === 0) depths[bi] = pts[i + 2]!
    }
    const r = swathFilter(depths, nPing, nBeam, winV, sigV)
    let n = 0
    for (let i = 0; i < r.flags.length; i++) {
      if (r.flags[i] === 1 && data.edits[i] !== 1) {
        data.edits[i] = 1
        n++
      }
    }
    await saveEdits(line, data.edits)
    updateStatus()
    redraw()
    status.textContent = `自动滤波新剔除 ${n} 点（窗口 ${winV}，${sigV}σ）`
  } }, ["自动滤波"])
  const restoreBtn = el("button", { class: "btn", onclick: async () => {
    if (!data) return
    data.edits.fill(0)
    await saveEdits(line, data.edits)
    updateStatus()
    redraw()
  } }, ["恢复全部"])

  root.append(
    el("div", { class: "card" }, [
      el("div", { class: "toolbar" }, [
        el("div", { class: "field" }, [el("label", {}, ["测线"]), lineSel]),
        modeBtn, pingSlider,
        numField("窗口", winV, (v) => (winV = Math.max(3, Math.round(v) | 1)), 2),
        numField("σ 倍数", sigV, (v) => (sigV = v), 0.5),
        filterBtn, restoreBtn, status,
      ]),
      el("div", { style: "color: var(--slate-500); font-size: var(--fs-xs)" }, ["三维视图：拖动旋转，Shift+拖动框选剔除；横截面：点击波束切换剔除"]),
    ]),
    el("div", { class: "canvas-wrap" }, [canvas]),
  )
  void load()
}
