// 应用外壳：侧边导航 + hash 路由

import { el, icon, ICONS } from "./ui"
import { state, on } from "./state"
import { renderVoyages } from "./pages/voyages"
import { renderSvp } from "./pages/svp"
import { renderCalibration } from "./pages/calibration"
import { renderCleaning } from "./pages/cleaning"
import { renderChart } from "./pages/chart"
import { renderSettings } from "./pages/settings"

const ROUTES: { path: string; name: string; icon: string; render: (root: HTMLElement) => void }[] = [
  { path: "voyages", name: "航次管理", icon: ICONS.voyage, render: renderVoyages },
  { path: "svp", name: "声速剖面", icon: ICONS.svp, render: renderSvp },
  { path: "calibration", name: "安装校准", icon: ICONS.calib, render: renderCalibration },
  { path: "cleaning", name: "条带清理", icon: ICONS.clean, render: renderCleaning },
  { path: "chart", name: "网格成图", icon: ICONS.chart, render: renderChart },
  { path: "settings", name: "设置", icon: ICONS.settings, render: renderSettings },
]

export const mountApp = (root: HTMLElement): void => {
  const nav = el("nav", { class: "nav" })
  const main = el("div", { class: "main" })
  root.append(nav, main)

  const brand = el("div", { class: "brand" }, ["多波束后处理", el("small", {}, ["MBES Workbench"])])
  const voyageTag = el("div", { class: "voyage-tag" }, ["未选择航次"])
  nav.append(brand)
  const links = new Map<string, HTMLElement>()
  for (const r of ROUTES) {
    const a = el("a", { href: `#/${r.path}` }, [icon(r.icon), r.name])
    links.set(r.path, a)
    nav.append(a)
  }
  nav.append(voyageTag)

  const updateVoyageTag = () => {
    voyageTag.textContent = state.voyage
      ? `当前航次：${state.voyage.name} · ${state.lines.length} 条测线`
      : "未选择航次"
  }
  on("voyage", updateVoyageTag)
  updateVoyageTag()

  const route = () => {
    const path = location.hash.replace(/^#\//, "") || "voyages"
    const r = ROUTES.find((x) => x.path === path) ?? ROUTES[0]!
    for (const [p, a] of links) a.classList.toggle("active", p === r.path)
    main.replaceChildren()
    r.render(main)
  }
  window.addEventListener("hashchange", route)
  route()
}
