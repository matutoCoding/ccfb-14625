// 测线服务：装块、重算、清理标记的读写，页面共用

import type { GeorefParams } from "@/core/georef"
import type { PingChunk, SurveyLine } from "@/core/types"
import { dbGet, dbPut, STORES } from "@/db/db"
import { recomputeLine, type RecomputeResult } from "@/proc/recompute"
import { state, ORIGIN_REF } from "@/ui/state"

export const loadChunks = async (line: SurveyLine): Promise<PingChunk[]> => {
  const chunks: PingChunk[] = []
  for (let i = 0; i < line.chunkCount; i++) {
    const c = await dbGet<PingChunk>(STORES.chunks, [line.id, i])
    if (c) chunks.push(c)
  }
  return chunks
}

export const loadEdits = async (line: SurveyLine): Promise<Uint8Array | undefined> =>
  dbGet<Uint8Array>(STORES.edits, line.id)

export const saveEdits = async (line: SurveyLine, edits: Uint8Array): Promise<void> => {
  await dbPut(STORES.edits, edits, line.id)
}

export const georefParams = (): GeorefParams => {
  const s = state.settings
  return {
    origin: ORIGIN_REF,
    mounting: s.mounting,
    lever: s.lever,
    draft: s.draft,
    sigmaTide: s.sigmaTide,
    sigmaHeave: s.sigmaHeave,
    sigmaRollDeg: s.sigmaRollDeg,
    sigmaSound: s.sigmaSound,
  }
}

export const runRecompute = async (
  line: SurveyLine,
  onProgress?: (f: number) => void,
): Promise<RecomputeResult> => {
  const chunks = await loadChunks(line)
  const edits = await loadEdits(line)
  const s = state.settings
  return recomputeLine(line, chunks, state.svp, state.tides, {
    georef: georefParams(),
    nadirCutDeg: s.nadirCutDeg,
    outerCutDeg: s.outerCutDeg,
    tideToleranceMs: s.tideToleranceMin * 60_000,
  }, edits, onProgress)
}

// 全航次重算（换剖面/改安装偏差后）
export const runRecomputeAll = async (
  onProgress?: (f: number, label: string) => void,
): Promise<{ totalMs: number; usedGpu: boolean }> => {
  let totalMs = 0
  let usedGpu = false
  for (let i = 0; i < state.lines.length; i++) {
    const line = state.lines[i]!
    const r = await runRecompute(line, (f) => onProgress?.((i + f) / state.lines.length, line.name))
    totalMs += r.elapsedMs
    usedGpu = usedGpu || r.usedGpu
  }
  return { totalMs, usedGpu }
}
