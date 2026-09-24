import axios, { AxiosError, type AxiosRequestConfig } from 'axios'
import type { ApiErrorShape } from '@/types'

/**
 * Only public configuration lives in the frontend (VITE_API_URL). No secrets.
 * Empty = same origin (the Worker serves /api on the app's domain, or the Vite dev proxy);
 * otherwise the Worker's origin, e.g. https://api.gymname.com.
 */
export const API_BASE = String(import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '')

export const api = axios.create({ baseURL: `${API_BASE}/api`, timeout: 20_000 })

let authToken: string | null = null
let unauthorizedHandler: (() => void) | null = null
let passwordChangeHandler: (() => void) | null = null

export function setAuthToken(token: string | null): void {
  authToken = token
}

export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler
}

export function onPasswordChangeRequired(handler: () => void): void {
  passwordChangeHandler = handler
}

export class ApiError extends Error implements ApiErrorShape {
  status: number
  code: string
  fields?: Record<string, string>

  constructor(shape: ApiErrorShape) {
    super(shape.message)
    this.status = shape.status
    this.code = shape.code
    this.fields = shape.fields
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

function normalize(error: AxiosError): ApiError {
  if (axios.isCancel(error) || error.code === 'ERR_CANCELED') {
    return new ApiError({ status: 0, code: 'CANCELLED', message: 'Request cancelled.' })
  }
  if (!error.response) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return new ApiError({ status: 0, code: 'OFFLINE', message: "You're offline. Reconnect to continue." })
    }
    if (error.code === 'ECONNABORTED') {
      return new ApiError({ status: 0, code: 'TIMEOUT', message: 'The server is taking too long to respond. Please try again.' })
    }
    return new ApiError({ status: 0, code: 'NETWORK', message: "We couldn't reach the gym's server. Check your connection and try again." })
  }
  const { status } = error.response
  const body = (error.response.data as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error
  if (status >= 500 && status !== 503) {
    return new ApiError({ status, code: body?.code ?? 'SERVER_ERROR', message: 'Something went wrong. Please try again.' })
  }
  return new ApiError({
    status,
    code: body?.code ?? `HTTP_${status}`,
    message: body?.message ?? (status === 404 ? "We couldn't find that." : "We couldn't complete that request."),
    fields: body?.fields,
  })
}

api.interceptors.request.use((config) => {
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const normalized = normalize(error)
    const isLogin = error.config?.url?.includes('/auth/login')
    if (normalized.status === 401 && !isLogin) unauthorizedHandler?.()
    if (normalized.code === 'PASSWORD_CHANGE_REQUIRED') passwordChangeHandler?.()
    return Promise.reject(normalized)
  },
)

export async function get<T>(url: string, params?: Record<string, unknown>, config: AxiosRequestConfig = {}): Promise<T> {
  const response = await api.get<T>(url, { ...config, params: clean(params) })
  return response.data
}

export async function post<T>(url: string, body?: unknown, config: AxiosRequestConfig = {}): Promise<T> {
  const response = await api.post<T>(url, body ?? {}, config)
  return response.data
}

export async function put<T>(url: string, body?: unknown): Promise<T> {
  const response = await api.put<T>(url, body ?? {})
  return response.data
}

export async function del<T = void>(url: string): Promise<T> {
  const response = await api.delete<T>(url)
  return response.data
}

function clean(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value
  }
  return out
}

export function idempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}
