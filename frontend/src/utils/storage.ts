// localStorage can be unavailable (private mode, blocked storage); never let it crash the app.

export function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export function readJSON<T>(key: string): T | null {
  const raw = readStorage(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writeJSON(key: string, value: unknown): void {
  writeStorage(key, value === null || value === undefined ? null : JSON.stringify(value))
}

export const KEYS = {
  token: 'smartgym.token',
  user: 'smartgym.user',
  theme: 'smartgym.theme',
  config: 'smartgym.config',
  memberQr: 'smartgym.member-qr',
  pageSize: 'smartgym.page-size',
  sidebar: 'smartgym.sidebar',
} as const
