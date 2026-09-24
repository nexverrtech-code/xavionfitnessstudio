import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfig } from '@/contexts/ConfigContext'

export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches))
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)')

/** Global keyboard shortcut, e.g. useHotkey('mod+k', open). Ignored while typing unless allowInInputs. */
export function useHotkey(combo: string, handler: (event: KeyboardEvent) => void, options: { allowInInputs?: boolean; enabled?: boolean } = {}): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    if (options.enabled === false) return
    const parts = combo.toLowerCase().split('+')
    const key = parts[parts.length - 1]
    const needsMod = parts.includes('mod')
    const needsShift = parts.includes('shift')
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key?.toLowerCase() !== key) return
      if (needsMod !== (event.metaKey || event.ctrlKey)) return
      if (needsShift !== event.shiftKey) return
      const target = event.target as HTMLElement | null
      const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if (typing && !options.allowInInputs && !needsMod) return
      event.preventDefault()
      handlerRef.current(event)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [combo, options.allowInInputs, options.enabled])
}

/** "Payments · Xavion Fitness Studio" — follows a renamed gym immediately. */
export function useDocumentTitle(title: string | undefined): void {
  const { gym_name } = useConfig()
  useEffect(() => {
    if (title) document.title = gym_name ? `${title} · ${gym_name}` : title
  }, [title, gym_name])
}

/** Prevents double submission and exposes a loading flag. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [loading, setLoading] = useState(false)
  const busy = useRef(false)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (busy.current) return undefined
    busy.current = true
    setLoading(true)
    try {
      return await fnRef.current(...args)
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [])
  return { run, loading }
}

export function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const handler = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside()
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [ref, onOutside, enabled])
}
