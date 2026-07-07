export type WovenThreadKey =
  | "branch_merge"
  | "find"
  | "codex"
  | "doc_audio"
  | "assistant"

export const WOVEN_THREAD_KEYS: WovenThreadKey[] = [
  "branch_merge",
  "find",
  "codex",
  "doc_audio",
  "assistant",
]

export const WOVEN_THREADS_STORAGE_KEY = "cr:threads-woven"
export const WOVEN_THREADS_EVENT = "cr:threads-woven-change"

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

export function getWovenThreads(): Set<WovenThreadKey> {
  if (!canUseLocalStorage()) return new Set()

  try {
    const raw = window.localStorage.getItem(WOVEN_THREADS_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter((key): key is WovenThreadKey =>
        WOVEN_THREAD_KEYS.includes(key as WovenThreadKey)
      )
    )
  } catch {
    return new Set()
  }
}

export function markThreadWoven(key: WovenThreadKey): void {
  if (!canUseLocalStorage()) return

  const woven = getWovenThreads()
  if (woven.has(key)) return

  woven.add(key)
  try {
    window.localStorage.setItem(
      WOVEN_THREADS_STORAGE_KEY,
      JSON.stringify(WOVEN_THREAD_KEYS.filter((threadKey) => woven.has(threadKey)))
    )
    window.dispatchEvent(new CustomEvent(WOVEN_THREADS_EVENT))
  } catch {
  }
}
