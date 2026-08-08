/**
 * Thin fetch wrapper around the Worker API.
 * In dev, Vite proxies /api to the local Worker (see vite.config.ts);
 * in production VITE_API_URL points at the deployed Worker.
 */
const BASE = import.meta.env.VITE_API_URL ?? ''

const TOKEN_KEY = 'almaz_pms_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type RequestOptions = {
  method?: string
  body?: unknown
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken()
  const response = await fetch(`${BASE}/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  })

  if (response.status === 204) return undefined as T

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ?? `Ошибка запроса (${response.status})`
    // An expired or revoked token drops the session; the guard sends the user to /login.
    if (response.status === 401) setToken(null)
    throw new ApiError(message, response.status)
  }

  return payload as T
}