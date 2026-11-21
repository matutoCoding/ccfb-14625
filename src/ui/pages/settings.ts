// 设置：安装偏差、杆臂、不确定度模型、角度截断、IHO 等级、GPU 基准

import { gpuInfo } from "@/gpu/device"
import { runRecompute } from "@/proc/line_service"
import { el, emptyState, numField, progressBar, ICONS } from "../ui"
import { state, saveSettings } from "../state"

export const renderSettings = (root: HTMLElement): void => {
  root.append(
    el("h2", { class: "page-title" }, ["设置"]),
    el("p", { class: "page-sub" }, ["安装偏差、传感器杆臂、不确定度模型与成图参数；修改后需重算生效"]),
  )
  if (!state.voyage) {
    root.append(emptyState("未选择航次", "先到「航次管理」选择或生成航次", ICONS.settings))
    return
  }
  const s = state.settings
  const save = () => void saveSettings()

  const mountingCard = el("div", { class: "card" }, [
    el("h3", {}, ["安装偏差（当前生效值，校准页求解后自动填入）"]),
    el("div", { class: "field-row" }, [
      numField("横摇 °", s.mounting.roll, (v) => { s.mounting.roll = v; save() }),
      numField("纵摇 °", s.mounting.pitch, (v) => { s.mounting.pitch = v; save() }),
      numField("艏向 °", s.mounting.heading, (v) => { s.mounting.heading = v; save() }),
      numField("时延 s", s.mounting.latency, (v) => { s.mounting.latency = v; save() }, 0.01),
    ]),
  ])
  const sensorCard = el("div", { class: "card" }, [
    el("h3", {}, ["传感器与不确定度模型"]),
    el("div", { class: "field-row" }, [
      numField("杆臂 x m", s.lever.x, (v) => { s.lever.x = v; save() }),
      numField("杆臂 y m", s.lever.y, (v) => { s.lever.y = v; save() }),
      numField("杆臂 z m", s.lever.z, (v) => { s.lever.z = v; save() }),
      numField("吃水 m", s.draft, (v) => { s.draft = v; save() }),
    ]),
    el("div", { class: "field-row", style: "margin-top: 12px" }, [
      numField("σ 潮位 m", s.sigmaTide, (v) => { s.sigmaTide = v; save() }, 0.01),
      numField("σ 升沉 m", s.sigmaHeave, (v) => { s.sigmaHeave = v; save() }, 0.01),
      numField("σ 横摇 °", s.sigmaRollDeg, (v) => { s.sigmaRollDeg = v; save() }, 0.01),
      numField("σ 声速测时 m", s.sigmaSound, (v) => { s.sigmaSound = v; save() }, 0.01),
    ]),
  ])
  const procCard = el("div", { class: "card" }, [
    el("h3", {}, ["处理参数"]),
    el("div", { class: "field-row" }, [
      numField("正下方截断角 °", s.nadirCutDeg, (v) => { s.nadirCutDeg = v; save() }, 1),
      numField("外侧截断角 °", s.outerCutDeg, (v) => { s.outerCutDeg = v; save() }, 1),
      numField("潮位容差 min", s.tideToleranceMin, (v) => { s.tideToleranceMin = v; save() }, 5),
      numField("IHO 最小点数/格", s.ihoMinPoints, (v) => { s.ihoMinPoints = Math.round(v); save() }, 1),
    ]),
    el("div", { class: "field-row", style: "margin-top: 12px" }, [
      (() => {
        const sel = el("select", {}, [
          el("option", { value: "special", selected: s.ihoOrder === "special" }, ["IHO 特等"]),
          el("option", { value: "order1a", selected: s.ihoOrder === "order1a" }, ["IHO 一等"]),
        ]) as HTMLSelectElement
        sel.addEventListener("change", () => {
          s.ihoOrder = sel.value as "special" | "order1a"
          save()
        })
        return el("div", { class: "field" }, [el("label", {}, ["IHO 测深等级"]), sel])
      })(),
      (() => {
        const cb = el("input", { type: "checkbox", checked: s.overlapWeight }) as HTMLInputElement
        cb.addEventListener("change", () => {
          s.overlapWeight = cb.checked
          save()
        })
        return el("div", { class: "field" }, [
          el("label", {}, ["重叠区入射角加权"]),
          el("div", { style: "display:flex; align-items:center; gap:8px; height: 34px" }, [cb, el("span", {}, ["cos²β 加权"])]),
        ])
      })(),
    ]),
  ])

  // GPU 状态与基准
  const gpuTag = el("span", { class: "tag" }, ["检测中…"])
  void gpuInfo().then((t) => (gpuTag.textContent = `WebGPU：${t}`))
  const pb = progressBar()
  const benchBtn = el("button", { class: "btn primary", onclick: async () => {
    const line = state.lines.find((l) => l.name === "BENCH_20K") ??
      [...state.lines].sort((a, b) => b.pingCount - a.pingCount)[0]
    if (!line) return
    benchBtn.setAttribute("disabled", "")
    const r = await runRecompute(line, (f) => pb.set(f, line.name))
    const ok = r.elapsedMs < 5000
    pb.set(1, `${line.name}（${line.pingCount} ping × ${line.nBeams} 波束 = ${(line.pingCount * line.nBeams / 1e6).toFixed(1)}M 波束）重算 ${r.elapsedMs.toFixed(0)} ms（${r.usedGpu ? "GPU" : "CPU"}）— 5 秒指标${ok ? "达标" : "未达标"}`)
    benchBtn.removeAttribute("disabled")
  } }, ["重算基准测试"])
  const gpuCard = el("div", { class: "card" }, [
    el("h3", {}, ["GPU 与性能"]),
    el("div", { class: "toolbar" }, [gpuTag, benchBtn]),
    pb.root,
  ])

  root.append(mountingCard, sensorCard, procCard, gpuCard)
}
