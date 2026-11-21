// 全局状态：当前航次、设置持久化、跨页事件

import type { IhoOrder } from "@/core/iho"
import type { LeverArm, Mounting, SurveyLine, SvpProfile, TideStation, Voyage } from "@/core/types"
import { dbAll, dbByIndex, dbGet, dbPut, STORES } from "@/db/db"
import { ORIGIN } from "@/sim/generate"

export interface AppSettings {
  mounting: Mounting
  lever: LeverArm
  draft: number
  sigmaTide: number
  sigmaHeave: number
  sigmaRollDeg: number
  sigmaSound: number
  nadirCutDeg: number
  outerCutDeg: number
  overlapWeight: boolean
  ihoOrder: IhoOrder
  ihoMinPoints: number
  gridCell: number
  tideToleranceMin: number
}

export const defaultSettings = (): AppSettings => ({
  mounting: { roll: 0, pitch: 0, heading: 0, latency: 0 },
  lever: { x: -2.0, y: -0.5, z: 3.0 },
  draft: 4.0,
  sigmaTide: 0.05,
  sigmaHeave: 0.05,
  sigmaRollDeg: 0.05,
  sigmaSound: 0.1,
  nadirCutDeg: 0,
  outerCutDeg: 70,
  overlapWeight: true,
  ihoOrder: "special",
  ihoMinPoints: 1,
  gridCell: 5,
  tideToleranceMin: 30,
})

export const ORIGIN_REF = ORIGIN

interface AppState {
  voyage: Voyage | null
  lines: SurveyLine[]
  svp: SvpProfile[]
  tides: TideStation[]
  settings: AppSettings
}

export const state: AppState = {
  voyage: null,
  lines: [],
  svp: [],
  tides: [],
  settings: defaultSettings(),
}

type Listener = () => void
const listeners = new Map<string, Set<Listener>>()

export const on = (event: string, fn: Listener): void => {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event)!.add(fn)
}

export const emit = (event: string): void => {
  for (const fn of listeners.get(event) ?? []) fn()
}

export const loadVoyage = async (voyageId: string): Promise<void> => {
  const voyage = await dbGet<Voyage>(STORES.voyages, voyageId)
  if (!voyage) return
  state.voyage = voyage
  state.lines = await dbByIndex<SurveyLine>(STORES.lines, "voyageId", voyageId)
  state.svp = await dbByIndex<SvpProfile>(STORES.svp, "voyageId", voyageId)
  state.tides = await dbByIndex<TideStation>(STORES.tides, "voyageId", voyageId)
  const saved = await dbGet<AppSettings>(STORES.settings, `settings:${voyageId}`)
  state.settings = saved ?? defaultSettings()
  await dbPut(STORES.settings, voyageId, "currentVoyage")
  emit("voyage")
}

export const saveSettings = async (): Promise<void> => {
  if (!state.voyage) return
  await dbPut(STORES.settings, state.settings, `settings:${state.voyage.id}`)
  emit("settings")
}

export const reloadLines = async (): Promise<void> => {
  if (!state.voyage) return
  state.lines = await dbByIndex<SurveyLine>(STORES.lines, "voyageId", state.voyage.id)
  emit("voyage")
}

export const restoreSession = async (): Promise<void> => {
  const id = await dbGet<string>(STORES.settings, "currentVoyage")
  if (id) await loadVoyage(id)
}

export const listVoyages = (): Promise<Voyage[]> => dbAll<Voyage>(STORES.voyages)
