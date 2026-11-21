// 航次管理：航次列表、测试数据生成、测线重算与内符合检查

import { dbDel, dbPut, dbEstimate, STORES } from "@/db/db"
import { generateVoyage, TRUE_MOUNTING } from "@/sim/generate"
import { runRecompute, runRecomputeAll } from "@/proc/line_service"
import { overlapCheck } from "@/proc/overlap"
import { el, emptyState, fmtTime, progressBar, ICONS } from "../ui"
import { listVoyages, loadVoyage, reloadLines, state } from "../state"
import type { Voyage } from "@/core/types"

export const renderVoyages = (root: HTMLElement): void => {
  root.append(
    el("h2", { class: "page-title" }, ["航次管理"]),
    el("p", { class: "page-sub" }, ["导入原始 ping 数据、生成测试航次、管理测线与存储"]),
  )
  const listCard = el("div", { class: "card" })
  const lineCard = el("div", { class: "card" })
  root.append(listCard, lineCard)

  const refreshLines = () => {
    lineCard.replaceChildren()
    if (!state.voyage) {
      lineCard.append(emptyState("未选择航次", "从上方列表选择，或生成一个测试航次", ICONS.ship))
      return
    }
    lineCard.append(el("h3", {}, [`测线列表 — ${state.voyage.name}`]))
    const tbl = el("table", { class: "tbl" })
    tbl.append(el("tr", {}, [
      el("th", {}, ["测线"]), el("th", {}, ["ping 数"]), el("th", {}, ["波束"]),
      el("th", {}, ["重算耗时"]), el("th", {}, ["内符合"]), el("th", {}, ["操作"]),
    ]))
    for (const line of state.lines) {
      const timeTd = el("td", { class: "mono" }, ["—"])
      const qcTd = el("td", {}, ["—"])
      const btn = el("button", { class: "btn", onclick: async () => {
        btn.textContent = "重算中…"
        btn.setAttribute("disabled", "")
        const r = await runRecompute(line)
        timeTd.textContent = `${r.elapsedMs.toFixed(0)} ms${r.usedGpu ? " (GPU)" : " (CPU)"}`
        btn.textContent = "重算"
        btn.removeAttribute("disabled")
      } }, ["重算"])
      const qcBtn = el("button", { class: "btn", onclick: async () => {
        // 与相邻测线做重叠区深度差统计
        const idx = state.lines.indexOf(line)
        const next = state.lines[idx + 1]
        if (!next) {
          qcTd.textContent = "无相邻线"
          return
        }
        qcTd.textContent = "统计中…"
        const s = await overlapCheck(line, next, state.settings.gridCell)
        qcTd.textContent = s
          ? `RMS ${s.rmsDiff.toFixed(3)}m · 均值 ${s.meanDiff.toFixed(3)}m · ${s.cells} 格`
          : "无重叠"
      } }, ["内符合"])
      tbl.append(el("tr", {}, [
        el("td", {}, [line.name]),
        el("td", { class: "mono" }, [String(line.pingCount)]),
        el("td", { class: "mono" }, [String(line.nBeams)]),
        timeTd, qcTd,
        el("td", {}, [el("span", { style: "display:flex; gap:8px" }, [btn, qcBtn])]),
      ]))
    }
    const allBtn = el("button", { class: "btn primary", onclick: async () => {
      allBtn.setAttribute("disabled", "")
      const t0 = performance.now()
      const r = await runRecomputeAll((f, label) => pb.set(f, `重算 ${label}`))
      pb.set(1, `全部完成：${r.totalMs.toFixed(0)} ms（${r.usedGpu ? "GPU" : "CPU"}），界面计时 ${(performance.now() - t0).toFixed(0)} ms`)
      allBtn.removeAttribute("disabled")
    } }, ["重算全部测线"])
    const pb = progressBar()
    lineCard.append(allBtn, el("div", { style: "margin: 12px 0" }, [pb.root]), tbl)
  }

  const refreshVoyages = async () => {
    listCard.replaceChildren()
    const voyages = await listVoyages()
    const est = await dbEstimate()
    const genBtn = el("button", { class: "btn primary" }, ["生成测试航次"])
    const benchBtn = el("button", { class: "btn" }, ["生成 + 2万ping基准线"])
    const pb = progressBar()
    const doGen = async (bench: boolean) => {
      genBtn.setAttribute("disabled", "")
      benchBtn.setAttribute("disabled", "")
      const g = await generateVoyage(`航次 ${new Date().toLocaleDateString()}`, (f, label) => pb.set(f * 0.7, label), bench)
      // 落库
      await dbPut(STORES.voyages, g.voyage)
      for (const p of g.svp) await dbPut(STORES.svp, { ...p, voyageId: g.voyage.id })
      for (const t of g.tides) await dbPut(STORES.tides, { ...t, voyageId: g.voyage.id })
      for (const { line, chunks } of g.lines) {
        await dbPut(STORES.lines, line)
        for (let i = 0; i < chunks.length; i++) await dbPut(STORES.chunks, chunks[i], [line.id, i])
      }
      // 保存安装偏差真值供校准页对照
      await dbPut(STORES.settings, TRUE_MOUNTING, `truth:${g.voyage.id}`)
      pb.set(0.75, "首次重算中…")
      await loadVoyage(g.voyage.id)
      const r = await runRecomputeAll((f, label) => pb.set(0.75 + f * 0.25, `重算 ${label}`))
      pb.set(1, `完成：${g.lines.length} 条测线，重算 ${r.totalMs.toFixed(0)} ms（${r.usedGpu ? "GPU" : "CPU"}）`)
      genBtn.removeAttribute("disabled")
      benchBtn.removeAttribute("disabled")
      await refreshVoyages()
      refreshLines()
    }
    genBtn.addEventListener("click", () => void doGen(false))
    benchBtn.addEventListener("click", () => void doGen(true))
    listCard.append(
      el("h3", {}, ["航次列表"]),
      el("div", { class: "toolbar" }, [
        genBtn, benchBtn,
        el("span", { class: "tag" }, [`存储 ${(est.usage / 1048576).toFixed(0)} MB / 配额 ${(est.quota / 1073741824).toFixed(1)} GB`]),
      ]),
      el("div", { style: "margin-bottom: 12px" }, [pb.root]),
    )
    if (voyages.length === 0) {
      listCard.append(emptyState("还没有航次", "点「生成测试航次」创建带海山、沟槽、沉船的模拟数据", ICONS.voyage))
      return
    }
    const tbl = el("table", { class: "tbl" })
    tbl.append(el("tr", {}, [el("th", {}, ["名称"]), el("th", {}, ["创建时间"]), el("th", {}, ["操作"])]))
    for (const v of voyages.sort((a, b) => b.createdAt - a.createdAt)) {
      const sel = el("button", { class: "btn", onclick: async () => {
        await loadVoyage(v.id)
        await refreshVoyages()
        refreshLines()
      } }, [state.voyage?.id === v.id ? "当前航次" : "选择"])
      const del = el("button", { class: "btn danger", onclick: async () => {
        await dbDel(STORES.voyages, v.id)
        await refreshVoyages()
      } }, ["删除"])
      tbl.append(el("tr", { class: state.voyage?.id === v.id ? "selected" : "" }, [
        el("td", {}, [v.name]),
        el("td", { class: "mono" }, [fmtTime(v.createdAt)]),
        el("td", {}, [el("span", { style: "display:flex; gap:8px" }, [sel, del])]),
      ]))
    }
    listCard.append(tbl)
  }

  void refreshVoyages()
  refreshLines()
}
