// UI 基础件：DOM 构建、图标、滑块、表单行

type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>

export const el = (tag: string, attrs: Attrs = {}, children: (Node | string)[] = []): HTMLElement => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    else if (k === "class") node.className = String(v)
    else if (typeof v === "boolean") { if (v) node.setAttribute(k, "") }
    else node.setAttribute(k, String(v))
  }
  for (const c of children) node.append(typeof c === "string" ? document.createTextNode(c) : c)
  return node
}

// 统一线性图标（stroke 1.6，圆角端点）
export const icon = (path: string): SVGSVGElement => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke-width", "1.6")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path")
  p.setAttribute("d", path)
  svg.append(p)
  return svg
}

export const ICONS = {
  voyage: "M3 17h18M5 17l2-9h10l2 9M9 8V5h6v3M12 5V3M8 21l1-4M16 21l-1-4",
  svp: "M4 4v16h16M7 15c2-1 3-5 5-6s3 2 5-3",
  calib: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M12 9a3 3 0 100 6 3 3 0 000-6z",
  clean: "M4 7h16M7 7v13h10V7M9 7V4h6v3M10 11v5M14 11v5",
  chart: "M4 19V5M4 19h16M7 15l3-6 3 4 4-8",
  settings: "M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  ship: "M4 15l1.5 4h13L20 15M12 15V6M8 10l4-4 4 4M2 19c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0",
  play: "M6 4l14 8-14 8V4z",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  plus: "M12 5v14M5 12h14",
  ruler: "M3 17L17 3l4 4L7 21l-4-4zM8 16l1.5 1.5M11 13l1.5 1.5M14 10l1.5 1.5",
}

export interface SliderOpts {
  label: string
  min: number
  max: number
  step: number
  value: number
  unit?: string
  onInput: (v: number) => void
}

export const sliderField = (o: SliderOpts): { root: HTMLElement; set: (v: number) => void } => {
  const val = el("span", { class: "val" }, [`${o.value.toFixed(2)}${o.unit ?? ""}`])
  const input = el("input", { type: "range", min: o.min, max: o.max, step: o.step, value: o.value }) as HTMLInputElement
  input.addEventListener("input", () => {
    const v = Number(input.value)
    val.textContent = `${v.toFixed(2)}${o.unit ?? ""}`
    o.onInput(v)
  })
  return {
    root: el("div", { class: "slider-field" }, [el("label", {}, [o.label]), input, val]),
    set: (v: number) => {
      input.value = String(v)
      val.textContent = `${v.toFixed(2)}${o.unit ?? ""}`
    },
  }
}

export const numField = (label: string, value: number, onChange: (v: number) => void, step = 0.1): HTMLElement => {
  const input = el("input", { type: "number", value, step }) as HTMLInputElement
  input.addEventListener("change", () => onChange(Number(input.value)))
  return el("div", { class: "field" }, [el("label", {}, [label]), input])
}

export const emptyState = (title: string, sub: string, iconPath: string): HTMLElement =>
  el("div", { class: "empty" }, [icon(iconPath), el("div", { class: "t" }, [title]), el("div", {}, [sub])])

export const progressBar = (): { root: HTMLElement; set: (f: number, label?: string) => void } => {
  const inner = el("div", {})
  const lab = el("span", { class: "mono", style: "font-size: var(--fs-xs); color: var(--slate-500)" }, [""])
  const root = el("div", {}, [el("div", { class: "progress" }, [inner]), lab])
  return {
    root,
    set: (f: number, label?: string) => {
      inner.setAttribute("style", `width: ${Math.round(f * 100)}%`)
      lab.textContent = label ?? ""
    },
  }
}

export const fmt = (v: number, digits = 2): string => v.toFixed(digits)
export const fmtTime = (ms: number): string => {
  const d = new Date(ms)
  const p = (x: number) => String(x).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
