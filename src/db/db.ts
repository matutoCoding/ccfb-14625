// IndexedDB 极简封装：promise 化 + 类型化仓库

const DB_NAME = "mbes_workbench"
const DB_VERSION = 1

export const STORES = {
  voyages: "voyages", // Voyage
  lines: "lines", // SurveyLine，索引 voyageId
  svp: "svp", // SvpProfile，索引 voyageId
  tides: "tides", // TideStation，索引 voyageId
  chunks: "chunks", // PingChunk，键 [lineId, idx]
  soundings: "soundings", // 解算结果，键 [lineId, idx]
  edits: "edits", // 清理标记，键 lineId
  settings: "settings", // 键值
} as const

let dbPromise: Promise<IDBDatabase> | null = null

export const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      db.createObjectStore(STORES.voyages, { keyPath: "id" })
      const lines = db.createObjectStore(STORES.lines, { keyPath: "id" })
      lines.createIndex("voyageId", "voyageId")
      const svp = db.createObjectStore(STORES.svp, { keyPath: "id" })
      svp.createIndex("voyageId", "voyageId")
      const tides = db.createObjectStore(STORES.tides, { keyPath: "id" })
      tides.createIndex("voyageId", "voyageId")
      db.createObjectStore(STORES.chunks)
      db.createObjectStore(STORES.soundings)
      db.createObjectStore(STORES.edits)
      db.createObjectStore(STORES.settings)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

const tx = async <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const dbGet = <T>(store: string, key: IDBValidKey): Promise<T | undefined> =>
  tx(store, "readonly", (s) => s.get(key) as IDBRequest<T>)

export const dbPut = (store: string, value: unknown, key?: IDBValidKey): Promise<IDBValidKey> =>
  tx(store, "readwrite", (s) => (key === undefined ? s.put(value) : s.put(value, key)))

export const dbDel = (store: string, key: IDBValidKey): Promise<undefined> =>
  tx(store, "readwrite", (s) => s.delete(key))

export const dbAll = <T>(store: string): Promise<T[]> =>
  tx(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>)

export const dbByIndex = async <T>(store: string, index: string, value: IDBValidKey): Promise<T[]> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, "readonly")
    const req = t.objectStore(store).index(index).getAll(value)
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

export const dbEstimate = async (): Promise<{ usage: number; quota: number }> => {
  const est = await navigator.storage.estimate()
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 }
}
