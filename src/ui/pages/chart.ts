// 网格成图：DEM 晕渲 + 色带 + 等深线 + IHO 覆盖检查 + 沉船放大/量测

import { autoLevels, contourLevel } from "@/core/contour"
import { cellDepth, type Grid } from "@/core/grid"
import { depthColor, renderGrid } from "@/core/hillshade"
import { coverageReport, suggestResurvey, type CoverageReport } from "@/core/iho"
import { gridLines } from "@/proc/gridder"
import { el, emptyState, ICONS } from "../ui"
import { state } from "../state"

export const renderChart = (root: HTMLElement): void => {
  root.append(
    el("h2", { class: "page-title" }, ["网格成图"]),
    el("p", { class: "page-sub" }, ["DEM 晕渲与等深线、IHO 覆盖率检查、小目标放大与量测；空格留空不插值"]),
  )
  if (!state.voyage || state.lines.length === 0) {
    root.append(emptyState("未选择航次", "先到「航次管理」选择或生成航次", ICONS.chart))
    return
  }
  const canvas = el("canvas", { width: 1100, height: 640 }) as HTMLCanvasElement
  const ctx = canvas.getContext("2d")!
  const status = el("span", { class: "tag" }, ["尚未成图"])
  let grid: Grid | null = null
  let report: CoverageReport | null = null
  let baseImg: HTMLCanvasElement | null = null
  let zMin = 0
  let zMax = 1
  // 视图变换
  let view = { cx: 0, cy: 0, scale: 1 }
  const show = { hill: true, contour: true, iho: false, resurvey: false }
  let measureMode = false
  let measurePts: [number, number][] = []
  let boxSel: { x0: number; y0: number; x1: number; y1: number } | null = null
  let shoalest: { e: number; n: number; d: number } | null = null

  const w2s = (e: number, n: number): [number, number] => [
    canvas.width / 2 + (e - view.cx) * view.scale,
    canvas.height / 2 - (n - view.cy) * view.scale,
  ]
  const s2w = (x: number, y: number): [number, number] => [
    view.cx + (x - canvas.width / 2) / view.scale,
    view.cy - (y - canvas.height / 2) / view.scale,
  ]

  const redraw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!grid || !baseImg) return
    // 底图：按视图变换贴晕渲图
    const [sx0, sy1] = w2s(grid.x0, grid.y0)
    const [sx1, sy0] = w2s(grid.x0 + grid.nx * grid.cell, grid.y0 + grid.ny * grid.cell)
    ctx.imageSmoothingEnabled = view.scale * grid.cell < 2
    ctx.drawImage(baseImg, sx0, sy0, sx1 - sx0, sy1 - sy0)
    // 等深线
    if (show.contour) {
      ctx.strokeStyle = "rgba(15,23,42,0.55)"
      ctx.lineWidth = 0.8
      for (const lv of autoLevels(zMin, zMax, 10)) {
        ctx.beginPath()
        for (const s of contourLevel(grid, lv)) {
          const [ax, ay] = w2s(s.x0, s.y0)
          const [bx, by] = w2s(s.x1, s.y1)
          ctx.moveTo(ax, ay)
          ctx.lineTo(bx, by)
        }
        ctx.stroke()
      }
    }
    // IHO 未达标格
    if (show.iho && report) {
      ctx.fillStyle = "rgba(220,38,38,0.35)"
      for (let iy = 0; iy < grid.ny; iy++) {
        for (let ix = 0; ix < grid.nx; ix++) {
          if (report.failMask[iy * grid.nx + ix] !== 1) continue
          const [px, py] = w2s(grid.x0 + ix * grid.cell, grid.y0 + (iy + 1) * grid.cell)
          const s = Math.max(1.5, grid.cell * view.scale)
          ctx.fillRect(px, py, s, s)
        }
      }
    }
    // 补测建议线
    if (show.resurvey && report) {
      ctx.strokeStyle = "#d97706"
      ctx.lineWidth = 2
      ctx.setLineDash([8, 4])
      for (const l of suggestResurvey(grid, report.failMask)) {
        const [ax, ay] = w2s(l.x0, l.y0)
        const [bx, by] = w2s(l.x1, l.y1)
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
      }
      ctx.setLineDash([])
    }
    // 最浅点标记
    if (shoalest) {
      const [px, py] = w2s(shoalest.e, shoalest.n)
      ctx.strokeStyle = "#dc2626"
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(px, py, 10, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = "#dc2626"
      ctx.font = "13px sans-serif"
      ctx.fillText(`最浅 ${shoalest.d.toFixed(2)} m`, px + 14, py - 8)
    }
    // 量测线
    if (measurePts.length > 0) {
      ctx.strokeStyle = "#0f172a"
      ctx.lineWidth = 1.5
      ctx.beginPath()
      const [ax, ay] = w2s(measurePts[0]![0], measurePts[0]![1])
      ctx.moveTo(ax, ay)
      if (measurePts[1]) {
        const [bx, by] = w2s(measurePts[1][0], measurePts[1][1])
        ctx.lineTo(bx, by)
      }
      ctx.stroke()
      if (measurePts[1]) {
        const d = Math.hypot(measurePts[1][0] - measurePts[0]![0], measurePts[1][1] - measurePts[0]![1])
        ctx.fillStyle = "#0f172a"
        ctx.font = "14px sans-serif"
        ctx.fillText(`${d.toFixed(1)} m`, (ax + (measurePts[1] ? w2s(measurePts[1][0], measurePts[1][1])[0] : ax)) / 2 + 8, ay - 8)
      }
    }
    if (boxSel) {
      ctx.strokeStyle = "#1d6fd1"
      ctx.setLineDash([5, 3])
      const [ax, ay] = w2s(boxSel.x0, boxSel.y1)
      const [bx, by] = w2s(boxSel.x1, boxSel.y0)
      ctx.strokeRect(ax, ay, bx - ax, by - ay)
      ctx.setLineDash([])
    }
  }

  const buildGrid = async () => {
    status.textContent = "格网化中…"
    const surveyLines = state.lines.filter((l) => !l.name.startsWith("PT_") && !l.name.startsWith("BENCH"))
    const r = await gridLines(surveyLines.length > 0 ? surveyLines : state.lines, state.settings.gridCell, state.settings.overlapWeight)
    grid = r.grid
    zMin = Infinity
    zMax = -Infinity
    for (let i = 0; i < grid.nx * grid.ny; i++) {
      const d = cellDepth(grid, i)
      if (Number.isFinite(d)) {
        if (d < zMin) zMin = d
        if (d > zMax) zMax = d
      }
    }
    if (!Number.isFinite(zMin)) {
      status.textContent = "无有效点"
      return
    }
    const img = renderGrid(grid, { zMin, zMax, hillshade: show.hill })
    baseImg = document.createElement("canvas")
    baseImg.width = grid.nx
    baseImg.height = grid.ny
    baseImg.getContext("2d")!.putImageData(img, 0, 0)
    report = coverageReport(grid, state.settings.ihoOrder, state.settings.ihoMinPoints)
    view = {
      cx: grid.x0 + (grid.nx * grid.cell) / 2,
      cy: grid.y0 + (grid.ny * grid.cell) / 2,
      scale: Math.min(canvas.width / (grid.nx * grid.cell), canvas.height / (grid.ny * grid.cell)) * 0.95,
    }
    status.textContent = `${r.usedPoints.toLocaleString()} 点 · ${grid.nx}×${grid.ny} 格 · ${r.elapsedMs.toFixed(0)} ms · 覆盖率 ${report.coveragePct.toFixed(1)}% · 达标 ${report.passPct.toFixed(1)}%`
    legendLabels()
    redraw()
  }

  // 色带图例
  const legend = el("canvas", { width: 320, height: 12, class: "legend-bar" }) as HTMLCanvasElement
  const legendLab = el("div", { style: "display:flex; justify-content:space-between; width:320px; font-size: var(--fs-xs); color: var(--slate-500)" })
  const legendLabels = () => {
    const lctx = legend.getContext("2d")!
    for (let x = 0; x < 320; x++) {
      const [r, g, b] = depthColor(x / 319)
      lctx.fillStyle = `rgb(${r},${g},${b})`
      lctx.fillRect(x, 0, 1, 12)
    }
    legendLab.replaceChildren(
      el("span", {}, [`${zMin.toFixed(1)} m（浅）`]),
      el("span", {}, [`${zMax.toFixed(1)} m（深）`]),
    )
  }

  // 交互：拖动平移 / 滚轮缩放 / shift 框选找最浅点 / 量测模式
  let drag: { x: number; y: number } | null = null
  let boxing = false
  canvas.addEventListener("mousedown", (e) => {
    drag = { x: e.offsetX, y: e.offsetY }
    boxing = e.shiftKey
    if (boxing) {
      const [e0, n0] = s2w(e.offsetX, e.offsetY)
      boxSel = { x0: e0, y0: n0, x1: e0, y1: n0 }
    } else if (measureMode) {
      const [e0, n0] = s2w(e.offsetX, e.offsetY)
      if (measurePts.length === 2) measurePts = []
      measurePts.push([e0, n0])
      redraw()
      drag = null
    }
  })
  canvas.addEventListener("mousemove", (e) => {
    if (!drag) {
      if (boxing && boxSel) {
        const [e1, n1] = s2w(e.offsetX, e.offsetY)
        boxSel.x1 = e1
        boxSel.y1 = n1
        redraw()
      }
      return
    }
    if (boxing && boxSel) {
      const [e1, n1] = s2w(e.offsetX, e.offsetY)
      boxSel.x1 = e1
      boxSel.y1 = n1
    } else {
      view.cx -= (e.offsetX - drag.x) / view.scale
      view.cy += (e.offsetY - drag.y) / view.scale
      drag = { x: e.offsetX, y: e.offsetY }
    }
    redraw()
  })
  canvas.addEventListener("mouseup", () => {
    if (boxing && boxSel && grid) {
      // 框选范围内找最浅点并放大
      let best = Infinity
      let be = 0
      let bn = 0
      const x0 = Math.min(boxSel.x0, boxSel.x1)
      const x1 = Math.max(boxSel.x0, boxSel.x1)
      const y0 = Math.min(boxSel.y0, boxSel.y1)
      const y1 = Math.max(boxSel.y0, boxSel.y1)
      for (let iy = 0; iy < grid.ny; iy++) {
        for (let ix = 0; ix < grid.nx; ix++) {
          const d = cellDepth(grid, iy * grid.nx + ix)
          if (!Number.isFinite(d)) continue
          const e = grid.x0 + (ix + 0.5) * grid.cell
          const n = grid.y0 + (iy + 0.5) * grid.cell
          if (e < x0 || e > x1 || n < y0 || n > y1) continue
          if (d < best) {
            best = d
            be = e
            bn = n
          }
        }
      }
      if (best < Infinity) {
        shoalest = { e: be, n: bn, d: best }
        view.cx = (x0 + x1) / 2
        view.cy = (y0 + y1) / 2
        view.scale = Math.min(canvas.width / Math.max(x1 - x0, 10), canvas.height / Math.max(y1 - y0, 10)) * 0.8
        status.textContent = `框选区最浅点 ${best.toFixed(2)} m @ (${be.toFixed(0)}, ${bn.toFixed(0)})`
      }
    }
    drag = null
    boxing = false
    boxSel = null
    redraw()
  })
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault()
    const k = e.deltaY < 0 ? 1.15 : 1 / 1.15
    view.scale = Math.max(0.01, Math.min(50, view.scale * k))
    redraw()
  }, { passive: false })

  // 工具栏
  const cellInput = el("input", { type: "number", value: state.settings.gridCell, min: 1, max: 50, style: "width: 70px" }) as HTMLInputElement
  cellInput.addEventListener("change", () => {
    state.settings.gridCell = Math.max(1, Number(cellInput.value))
  })
  const mkToggle = (label: string, key: keyof typeof show) => {
    const b = el("button", { class: "btn" }, [label])
    b.addEventListener("click", () => {
      show[key] = !show[key]
      b.classList.toggle("primary", show[key])
      if (key === "hill" && grid) void buildGrid()
      else redraw()
    })
    if (show[key]) b.classList.add("primary")
    return b
  }
  const measureBtn = el("button", { class: "btn" }, ["量测"])
  measureBtn.addEventListener("click", () => {
    measureMode = !measureMode
    measurePts = []
    measureBtn.classList.toggle("primary", measureMode)
  })
  const wreckBtn = el("button", { class: "btn", onclick: () => {
    // 一键定位沉船区（测区内找全局最浅点周围）
    if (!grid) return
    let best = Infinity
    let be = 0
    let bn = 0
    for (let i = 0; i < grid.nx * grid.ny; i++) {
      const d = cellDepth(grid, i)
      if (Number.isFinite(d) && d < best) {
        best = d
        be = grid.x0 + ((i % grid.nx) + 0.5) * grid.cell
        bn = grid.y0 + (Math.floor(i / grid.nx) + 0.5) * grid.cell
      }
    }
    shoalest = { e: be, n: bn, d: best }
    view.cx = be
    view.cy = bn
    view.scale = 2.5
    status.textContent = `全局最浅点 ${best.toFixed(2)} m @ (${be.toFixed(0)}, ${bn.toFixed(0)}) — Shift 框选船身，量测模式量船长`
    redraw()
  } }, ["找最浅点"])

  root.append(
    el("div", { class: "card" }, [
      el("div", { class: "toolbar" }, [
        el("div", { class: "field" }, [el("label", {}, ["格网大小 m"]), cellInput]),
        el("button", { class: "btn primary", onclick: () => void buildGrid() }, ["成图"]),
        mkToggle("晕渲", "hill"), mkToggle("等深线", "contour"), mkToggle("IHO 覆盖", "iho"), mkToggle("补测线", "resurvey"),
        measureBtn, wreckBtn, status,
      ]),
      el("div", { style: "color: var(--slate-500); font-size: var(--fs-xs)" }, [
        "拖动平移 · 滚轮缩放 · Shift+拖动框选放大找最浅点 · 量测模式点两点测距（如沉船船长）",
      ]),
    ]),
    el("div", { class: "canvas-wrap" }, [canvas]),
    el("div", { class: "card", style: "margin-top: 16px" }, [el("h3", {}, ["深度色带"]), legend, legendLab]),
  )
}
