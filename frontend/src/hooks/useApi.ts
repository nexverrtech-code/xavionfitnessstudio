import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiError } from '@/services/api'

/**
 * Minimal stale-while-revalidate data hook (no extra dependency).
 * Cached data renders instantly on revisit while a fresh request runs in the background.
 * Keys are strings such as "members:list:page=1"; `invalidate("members")` refreshes every
 * mounted query whose key starts with that prefix.
 *
 * To keep D1 reads low, components asking for the same key at the same time share one
 * request, and data younger than FRESH_MS is reused without a request at all (every
 * mutation invalidates the keys it affects, so this never hides your own changes).
 */

interface Entry {
  data: unknown
  time: number
}

interface Inflight {
  promise: Promise<unknown>
  controller: AbortController
  refs: number
}

const cache = new Map<string, Entry>()
const inflight = new Map<string, Inflight>()
const subscribers = new Map<string, Set<() => void>>()
const MAX_ENTRIES = 150
const FRESH_MS = 15_000

function remember(key: string, data: unknown): void {
  cache.delete(key)
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
  cache.set(key, { data, time: Date.now() })
}

function request(key: string, fetcher: (signal: AbortSignal) => Promise<unknown>): Inflight {
  let entry = inflight.get(key)
  if (!entry) {
    const controller = new AbortController()
    const promise = fetcher(controller.signal).then((data) => {
      if (!controller.signal.aborted) remember(key, data)
      return data
    })
    const created: Inflight = { promise, controller, refs: 0 }
    const done = () => {
      if (inflight.get(key) === created) inflight.delete(key)
    }
    promise.then(done, done)
    inflight.set(key, created)
    entry = created
  }
  entry.refs += 1
  return entry
}

function release(key: string, entry: Inflight): void {
  entry.refs -= 1
  // Deferred so a component that re-subscribes immediately (StrictMode, key flip-flop)
  // keeps the request instead of cancelling and re-sending it.
  setTimeout(() => {
    if (entry.refs <= 0 && inflight.get(key) === entry) {
      inflight.delete(key)
      entry.controller.abort()
    }
  }, 0)
}

export function invalidate(...prefixes: string[]): void {
  const matches = (key: string) => prefixes.some((p) => key.startsWith(p))
  // A request that started before the change may carry old data: drop it.
  for (const [key, entry] of [...inflight]) {
    if (matches(key)) {
      inflight.delete(key)
      entry.controller.abort()
    }
  }
  for (const key of [...cache.keys()]) {
    if (matches(key)) cache.delete(key)
  }
  for (const [key, listeners] of subscribers) {
    if (matches(key)) listeners.forEach((fn) => fn())
  }
}

export function clearApiCache(): void {
  for (const entry of inflight.values()) entry.controller.abort()
  inflight.clear()
  cache.clear()
}

export interface ApiState<T> {
  data: T | undefined
  error: ApiError | undefined
  loading: boolean
  refreshing: boolean
  reload: () => void
  setData: (updater: (current: T | undefined) => T | undefined) => void
}

export function useApi<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
  /** `freshMs`: how long cached data is reused without a request (default 15 s). */
  options: { keepPrevious?: boolean; freshMs?: number } = {},
): ApiState<T> {
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean; refreshing: boolean }>(() => {
    const cached = key ? cache.get(key) : undefined
    return { data: cached?.data as T | undefined, loading: !!key && !cached, refreshing: false }
  })

  useEffect(() => {
    if (!key) {
      setState({ loading: false, refreshing: false })
      return
    }
    const cached = cache.get(key)
    const fresh = !!cached && Date.now() - cached.time < (options.freshMs ?? FRESH_MS)
    setState((prev) => ({
      data: cached ? (cached.data as T) : options.keepPrevious ? prev.data : undefined,
      error: undefined,
      loading: !cached && !(options.keepPrevious && prev.data !== undefined),
      refreshing: !fresh,
    }))
    if (fresh) return

    let active = true
    const entry = request(key, fetcherRef.current)
    entry.promise.then(
      (data) => {
        if (active) setState({ data: data as T, loading: false, refreshing: false })
      },
      (error: ApiError) => {
        if (!active || error?.code === 'CANCELLED') return
        setState((prev) => ({ data: prev.data, error, loading: false, refreshing: false }))
      },
    )
    return () => {
      active = false
      release(key, entry)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version])

  useEffect(() => {
    if (!key) return
    const listener = () => setVersion((v) => v + 1)
    let set = subscribers.get(key)
    if (!set) subscribers.set(key, (set = new Set()))
    set.add(listener)
    return () => {
      set!.delete(listener)
      if (set!.size === 0) subscribers.delete(key)
    }
  }, [key])

  const reload = useCallback(() => {
    if (key) cache.delete(key)
    setVersion((v) => v + 1)
  }, [key])

  const setData = useCallback(
    (updater: (current: T | undefined) => T | undefined) => {
      setState((prev) => {
        const data = updater(prev.data)
        if (key && data !== undefined) remember(key, data)
        return { ...prev, data }
      })
    },
    [key],
  )

  return { data: state.data, error: state.error, loading: state.loading, refreshing: state.refreshing, reload, setData }
}
