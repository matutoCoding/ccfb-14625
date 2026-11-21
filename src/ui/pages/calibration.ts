// 安装校准：patch test —— 滑块实时叠图 + 自动求解（横摇闭式 / 纵摇艏向扫描）

import { georefBeam } from "@/core/georef"
import { buildLayers } from "@/core/ray_trace"
import { tideAt } from "@/core/tide"
import type { SurveyLine } from "@/core/types"
import { dbGet, STORES } from "@/db/db"
import { loadChunks, georefParams, runRecomputeAll } from "@/proc/line_service"
import { recomputeLine } from "@/proc/recompute"
import { extractProfile, solveHeading, solvePitch, solveRoll } from "@/proc/patch"
import { el, emptyState, progressBar, sliderField, ICONS } from "../ui"
import { state, saveSettings } from "../state"
import type { Mounting } from "@/core/types"

const PAIRS: { key: string; label: string; a: string; b: string }[] = [
  { key: "roll", label: "横摇（平坦海底往返线）", a: "PT_ROLL_A", b: "PT_ROLL_B" },
  { key: "pitch", label: "纵摇（海山同向异速线）", a: "PT_PITCH_A", b: "PT_PITCH_B" },
  { key: "heading", label: "艏向（海山往返线）", a: "PT_HDG_A", b: "PT_HDG_B" },
]

export const renderCalibration = (root: HTMLElement): void => {
  root.append(
    el("h2", { class: "page-title" }, ["安装偏差校准"]),
    el("p", { class: "page-sub" }, ["Patch test：拖动偏差角，两条测线的横截面实时叠合；或按测线对自动求解"]),
  )
  if (!state.voyage) {
    root.append(emptyState("未选择航次", "先到「航次管理」选择或生成航次", ICONS.calib))
    return
  }
  // 工作副本，应用前不落库
  const trial: Mounting = { ...state.settings.mounting }
  const canvas = el("canvas", { width: 960, height: 420 }) as HTMLCanvasElement
  const status = el("span", { class: "tag" }, [""])
  let pair = PAIRS[0]!
  let lineA: SurveyLine | undefined
  let lineB: SurveyLine | undefined

  // 横截面叠图：两线各取中部 120 ping，按横向距离分箱平均
  const drawOverlay = async () => {
    if (!lineA || !lineB) return
    const ctx = canvas.getContext("2d")!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const prm = { ...georefParams(), mounting: { ...trial } }
    const profiles: number[][] = []
    for (const line of [lineA, lineB]) {
      const chunks = await loadChunks(line)
      const bins = new Map<number, { s: number; c: number }>()
      const midChunk = chunks[Math.floor(chunks.length / 2)]!
      const pings = midChunk.heads.slice(0, 120)
      for (let pi = 0; pi < pings.length; pi++) {
        const h = pings[pi]!
        const prof = state.svp.find((p) => p.id === h.svpId)
        if (!prof) continue
        const layers = buildLayers(prof.points, 1000)
        const tide = tideAt(state.tides, prm.origin, h.lat, h.lon, h.time, 30 * 60_000)
        for (let b = 0; b < line.nBeams; b += 2) {
          const i = pi * line.nBeams + b
          const ttw = midChunk.travelTime[i]!
          if (ttw <= 0) continue
          const hit = georefBeam(layers, h.lat, h.lon, h.att, midChunk.beamAngle[i]!, ttw, tide.height, prm)
          if (!hit.ok) continue
          const k = Math.round(hit.across / 2)
          const bin = bins.get(k)
          if (bin) {
            bin.s += hit.depth
            bin.c++
          } else bins.set(k, { s: hit.depth, c: 1 })
        }
      }
      const pts = [...bins.entries()].sort((x, y) => x[0] - y[0]).map(([k, v]) => [k * 2, v.s / v.c] as number[])
      profiles.push(pts.flat())
    }
    // 绘制
    const all = profiles.flat()
    const xs = all.filter((_, i) => i % 2 === 0)
    const ys = all.filter((_, i) => i % 2 === 1)
    if (xs.length === 0) return
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    const y0 = Math.min(...ys) - 2
    const y1 = Math.max(...ys) + 2
    const X = (v: number) => 40 + ((v - x0) / (x1 - x0)) * (canvas.width - 60)
    const Y = (v: number) => 20 + ((v - y0) / (y1 - y0)) * (canvas.height - 60)
    ctx.fillStyle = "#64748b"
    ctx.font = "12px sans-serif"
    for (let i = 0; i <= 5; i++) {
      const v = y0 + ((y1 - y0) * i) / 5
      ctx.fillText(v.toFixed(1), 4, Y(v) + 4)
    }
    ctx.fillText("横向距离 m →", canvas.width - 110, canvas.height - 8)
    const colors = ["#dc2626", "#0d9488"]
    const names = [lineA.name, lineB.name]
    profiles.forEach((flat, idx) => {
      ctx.strokeStyle = colors[idx]!
      ctx.lineWidth = 1.6
      ctx.beginPath()
      for (let i = 0; i < flat.length; i += 2) {
        const px = X(flat[i]!)
        const py = Y(flat[i + 1]!)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
      ctx.fillStyle = colors[idx]!
      ctx.fillText(names[idx]!, canvas.width - 160, 24 + idx * 18)
    })
  }

  let drawQueued = false
  const queueDraw = () => {
    if (drawQueued) return
    drawQueued = true
    requestAnimationFrame(() => {
      drawQueued = false
      void drawOverlay()
    })
  }

  const sliders = {
    roll: sliderField({ label: "横摇", min: -3, max: 3, step: 0.01, value: trial.roll, unit: "°", onInput: (v) => { trial.roll = v; queueDraw() } }),
    pitch: sliderField({ label: "纵摇", min: -3, max: 3, step: 0.01, value: trial.pitch, unit: "°", onInput: (v) => { trial.pitch = v; queueDraw() } }),
    heading: sliderField({ label: "艏向", min: -3, max: 3, step: 0.01, value: trial.heading, unit: "°", onInput: (v) => { trial.heading = v; queueDraw() } }),
  }

  const findLine = (name: string) => state.lines.find((l) => l.name === name)

  const selectPair = async (p: typeof PAIRS[number]) => {
    pair = p
    lineA = findLine(p.a)
    lineB = findLine(p.b)
    status.textContent = lineA && lineB ? `测线对：${p.a} × ${p.b}` : `缺少 ${p.a}/${p.b}（重新生成测试航次）`
    pairLabel.textContent = p.label
    await drawOverlay()
  }

  const solve = async () => {
    if (!lineA || !lineB) return
    status.textContent = "求解中（先按当前值重算两条线）…"
    // 求解基于当前 trial 值下的解算结果
    const st = state.settings
    const prm = { ...georefParams(), mounting: { ...trial } }
    for (const line of [lineA, lineB]) {
      const chunks = await loadChunks(line)
      await recomputeLine(line, chunks, state.svp, state.tides, {
        georef: prm, nadirCutDeg: st.nadirCutDeg, outerCutDeg: st.outerCutDeg, tideToleranceMs: st.tideToleranceMin * 60_000,
      }, undefined)
    }
    const pa = await extractProfile(lineA)
    const pb = await extractProfile(lineB)
    if (pair.key === "roll") trial.roll = solveRoll(pa, pb, trial.roll)
    else if (pair.key === "pitch") trial.pitch = solvePitch(pa, pb, trial.pitch)
    else trial.heading = solveHeading(pa, pb, trial.heading)
    sliders.roll.set(trial.roll)
    sliders.pitch.set(trial.pitch)
    sliders.heading.set(trial.heading)
    status.textContent = `求解完成：横摇 ${trial.roll.toFixed(3)}° 纵摇 ${trial.pitch.toFixed(3)}° 艏向 ${trial.heading.toFixed(3)}°`
    await drawOverlay()
  }

  const pairLabel = el("h3", {}, [pair.label])
  const pairBtns = el("div", { class: "toolbar" }, PAIRS.map((p) =>
    el("button", { class: "btn", onclick: () => void selectPair(p) }, [p.label.slice(0, 2)]),
  ))
  const solveBtn = el("button", { class: "btn primary", onclick: () => void solve() }, ["自动求解当前参数"])
  const pb = progressBar()
  const applyBtn = el("button", { class: "btn primary", onclick: async () => {
    state.settings.mounting = { ...trial }
    await saveSettings()
    applyBtn.setAttribute("disabled", "")
    const r = await runRecomputeAll((f, label) => pb.set(f, `重算 ${label}`))
    pb.set(1, `已应用并重算全航次：${r.totalMs.toFixed(0)} ms（${r.usedGpu ? "GPU" : "CPU"}）`)
    applyBtn.removeAttribute("disabled")
  } }, ["应用并重算全航次"])

  // 真值对照（测试数据）
  const truthBox = el("div", { class: "stat-row" })
  void dbGet<Mounting>(STORES.settings, `truth:${state.voyage.id}`).then((t) => {
    if (!t) return
    truthBox.append(
      el("div", { class: "stat" }, [el("span", { class: "v" }, [`${t.roll.toFixed(2)}°`]), el("span", { class: "k" }, ["横摇真值"])]),
      el("div", { class: "stat" }, [el("span", { class: "v" }, [`${t.pitch.toFixed(2)}°`]), el("span", { class: "k" }, ["纵摇真值"])]),
      el("div", { class: "stat" }, [el("span", { class: "v" }, [`${t.heading.toFixed(2)}°`]), el("span", { class: "k" }, ["艏向真值"])]),
    )
  })

  root.append(
    el("div", { class: "card" }, [pairLabel, pairBtns, status]),
    el("div", { class: "card" }, [
      el("h3", {}, ["偏差角调整"]),
      sliders.roll.root, sliders.pitch.root, sliders.heading.root,
      el("div", { class: "toolbar", style: "margin-top: 16px" }, [solveBtn, applyBtn]),
      pb.root,
    ]),
    el("div", { class: "canvas-wrap", style: "margin-bottom: 16px" }, [canvas]),
    el("div", { class: "card" }, [el("h3", {}, ["真值对照（模拟数据）"]), truthBox]),
  )
  void selectPair(PAIRS[0]!)
}
