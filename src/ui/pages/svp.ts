// 声速剖面：CTD 投放管理、剖面图、编辑、精度验证（解析解 vs 独立数值积分）

import { buildLayers, traceBeam } from "@/core/ray_trace"
import { traceBeamNumeric } from "@/core/ray_trace_num"
import { pickSvp } from "@/core/svp"
import type { SvpProfile } from "@/core/types"
import { dbPut, STORES } from "@/db/db"
import { loadChunks, runRecomputeAll } from "@/proc/line_service"
import { el, emptyState, fmtTime, progressBar, ICONS } from "../ui"
import { state, ORIGIN_REF } from "../state"

// 剖面图：声速横轴、深度纵轴（向下）
const drawProfile = (canvas: HTMLCanvasElement, p: SvpProfile): void => {
  const ctx = canvas.getContext("2d")!
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)
  const cs = p.points.map((x) => x.c)
  const zs = p.points.map((x) => x.z)
  const c0 = Math.min(...cs) - 2
  const c1 = Math.max(...cs) + 2
  const z1 = Math.max(...zs) * 1.05
  const X = (c: number) => 40 + ((c - c0) / (c1 - c0)) * (W - 60)
  const Y = (z: number) => 16 + (z / z1) * (H - 48)
  ctx.strokeStyle = "#e2e8f0"
  ctx.fillStyle = "#64748b"
  ctx.font = "12px sans-serif"
  for (let i = 0; i <= 4; i++) {
    const c = c0 + ((c1 - c0) * i) / 4
    ctx.beginPath()
    ctx.moveTo(X(c), 16)
    ctx.lineTo(X(c), H - 32)
    ctx.stroke()
    ctx.fillText(c.toFixed(0), X(c) - 10, H - 16)
  }
  for (let i = 0; i <= 4; i++) {
    const z = (z1 * i) / 4
    ctx.fillText(z.toFixed(0), 4, Y(z) + 4)
  }
  ctx.strokeStyle = "#1d6fd1"
  ctx.lineWidth = 2
  ctx.beginPath()
  p.points.forEach((pt, i) => {
    if (i === 0) ctx.moveTo(X(pt.c), Y(pt.z))
    else ctx.lineTo(X(pt.c), Y(pt.z))
  })
  ctx.stroke()
  ctx.fillStyle = "#1d6fd1"
  for (const pt of p.points) {
    ctx.beginPath()
    ctx.arc(X(pt.c), Y(pt.z), 3, 0, Math.PI * 2)
    ctx.fill()
  }
}

export const renderSvp = (root: HTMLElement): void => {
  root.append(
    el("h2", { class: "page-title" }, ["声速剖面"]),
    el("p", { class: "page-sub" }, ["按 CTD 投放时间与位置管理，每个 ping 自动匹配最近剖面，换剖面后整线 GPU 重算"]),
  )
  if (!state.voyage) {
    root.append(emptyState("未选择航次", "先到「航次管理」选择或生成航次", ICONS.svp))
    return
  }
  const listCard = el("div", { class: "card" })
  const detailCard = el("div", { class: "card" })
  const verifyCard = el("div", { class: "card" })
  root.append(listCard, detailCard, verifyCard)

  let selected: SvpProfile | undefined = state.svp[0]

  const renderDetail = () => {
    detailCard.replaceChildren()
    if (!selected) return
    const canvas = el("canvas", { width: 520, height: 360, style: "max-width: 520px" }) as HTMLCanvasElement
    drawProfile(canvas, selected)
    // 编辑区：每行 深度,声速
    const ta = el("textarea", {
      rows: 10, style: "width: 260px; font-family: monospace",
    }, [selected.points.map((p) => `${p.z}, ${p.c}`).join("\n")]) as HTMLTextAreaElement
    const saveBtn = el("button", { class: "btn primary", onclick: async () => {
      const pts = ta.value.split("\n").map((l) => l.split(",").map(Number)).filter((a) => a.length === 2 && a.every(Number.isFinite))
        .map(([z, c]) => ({ z: z!, c: c! }))
      if (pts.length < 2) return
      selected!.points = pts
      await dbPut(STORES.svp, { ...selected, voyageId: state.voyage!.id })
      drawProfile(canvas, selected!)
      saveBtn.textContent = "已保存"
      setTimeout(() => (saveBtn.textContent = "保存修改"), 1200)
    } }, ["保存修改"])
    const pb = progressBar()
    const recomputeBtn = el("button", { class: "btn", onclick: async () => {
      recomputeBtn.setAttribute("disabled", "")
      const r = await runRecomputeAll((f, label) => pb.set(f, `重算 ${label}`))
      pb.set(1, `全航次重算完成：${r.totalMs.toFixed(0)} ms（${r.usedGpu ? "GPU" : "CPU"}）`)
      recomputeBtn.removeAttribute("disabled")
    } }, ["应用并重算全航次"])
    // 重新匹配：按时间/位置为每个 ping 重选剖面
    const rematchBtn = el("button", { class: "btn", onclick: async () => {
      rematchBtn.setAttribute("disabled", "")
      for (const line of state.lines) {
        const chunks = await loadChunks(line)
        let changed = false
        for (const c of chunks) {
          for (const h of c.heads) {
            const p = pickSvp(state.svp, ORIGIN_REF, h.time, h.lat, h.lon)
            if (p && p.id !== h.svpId) {
              h.svpId = p.id
              changed = true
            }
          }
        }
        if (changed) {
          for (let i = 0; i < chunks.length; i++) await dbPut(STORES.chunks, chunks[i], [line.id, i])
        }
      }
      rematchBtn.textContent = "已重新匹配"
      rematchBtn.removeAttribute("disabled")
      setTimeout(() => (rematchBtn.textContent = "重新匹配最近剖面"), 1500)
    } }, ["重新匹配最近剖面"])
    detailCard.append(
      el("h3", {}, [`${selected.name} · ${fmtTime(selected.time)} · ${selected.lat.toFixed(4)}°N ${selected.lon.toFixed(4)}°E`]),
      el("div", { style: "display: flex; gap: 24px; flex-wrap: wrap" }, [
        canvas,
        el("div", { class: "field" }, [el("label", {}, ["深度(m), 声速(m/s) — 每行一对"]), ta, saveBtn]),
      ]),
      el("div", { class: "toolbar", style: "margin-top: 16px" }, [rematchBtn, recomputeBtn]),
      pb.root,
    )
  }

  const renderList = () => {
    listCard.replaceChildren()
    listCard.append(el("h3", {}, [`CTD 投放（${state.svp.length} 次）`]))
    const tbl = el("table", { class: "tbl" })
    tbl.append(el("tr", {}, [el("th", {}, ["名称"]), el("th", {}, ["投放时间"]), el("th", {}, ["位置"]), el("th", {}, ["层数"])]))
    for (const p of state.svp) {
      const tr = el("tr", { class: p === selected ? "selected" : "", onclick: () => {
        selected = p
        renderList()
        renderDetail()
        renderVerify()
      } }, [
        el("td", {}, [p.name]),
        el("td", { class: "mono" }, [fmtTime(p.time)]),
        el("td", { class: "mono" }, [`${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`]),
        el("td", { class: "mono" }, [String(p.points.length)]),
      ])
      tr.style.cursor = "pointer"
      tbl.append(tr)
    }
    listCard.append(tbl)
  }

  // 精度验证：解析解 vs RK4 数值积分，验收标准 = 深度差 < 水深千分之一
  const renderVerify = () => {
    verifyCard.replaceChildren()
    verifyCard.append(el("h3", {}, ["声线追踪精度验证（解析解 vs 独立 RK4 积分）"]))
    if (!selected) return
    const runBtn = el("button", { class: "btn primary" }, ["运行验证"])
    const out = el("div", { class: "stat-row", style: "margin-top: 12px" })
    runBtn.addEventListener("click", () => {
      const layers = buildLayers(selected!.points, 1000)
      let maxRel = 0
      let maxAbs = 0
      let worst = ""
      for (let deg = 0; deg <= 70; deg += 5) {
        for (let t = 0.05; t <= 0.4; t += 0.05) {
          const a = traceBeam(layers, deg * Math.PI / 180, t)
          const b = traceBeamNumeric(selected!.points, deg * Math.PI / 180, t)
          if (b.z < 1) continue
          const rel = Math.abs(a.z - b.z) / b.z
          if (rel > maxRel) {
            maxRel = rel
            maxAbs = Math.abs(a.z - b.z)
            worst = `${deg}° / ${t.toFixed(2)}s`
          }
        }
      }
      const pass = maxRel < 0.001
      out.replaceChildren(
        el("div", { class: "stat" }, [el("span", { class: "v" }, [maxAbs.toFixed(4)]), el("span", { class: "k" }, ["最大深度差 m"])]),
        el("div", { class: "stat" }, [el("span", { class: "v" }, [(maxRel * 1000).toFixed(4)]), el("span", { class: "k" }, ["最大相对偏差（千分比）"])]),
        el("div", { class: "stat" }, [el("span", { class: "v" }, [worst]), el("span", { class: "k" }, ["最差工况"])]),
        el("div", { class: "stat" }, [el("span", { class: "v" }, [pass ? "通过" : "未通过"]), el("span", { class: "k" }, ["千分之一验收"])]),
      )
    })
    verifyCard.append(runBtn, out)
  }

  renderList()
  renderDetail()
  renderVerify()
}
