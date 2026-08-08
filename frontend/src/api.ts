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
  body?: unknown | FormData
}

/**
 * Downloads an authenticated endpoint straight to a file.
 *
 * A plain <a href> cannot carry the bearer token, so the body is fetched and
 * handed to the browser as a blob, keeping the filename the server chose.
 */
export async function downloadAuthed(path: string, fallbackName: string): Promise<void> {
  const token = getToken()
  const response = await fetch(`${BASE}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = (payload as { error?: string } | null)?.error ?? `Ошибка (${response.status})`
    if (response.status === 401) setToken(null)
    throw new ApiError(message, response.status)
  }

  const disposition = response.headers.get('Content-Disposition') ?? ''
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName

  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getToken()
  // FormData sets its own multipart boundary; forcing a JSON content-type on it
  // would make the body unparseable on the other end.
  const isForm = options.body instanceof FormData

  const response = await fetch(`${BASE}/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body !== undefined
      ? { body: isForm ? (options.body as FormData) : JSON.stringify(options.body) }
      : {}),
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
/**
 * Fetches a protected binary endpoint and returns an object URL for it.
 *
 * Images need the bearer token, which an <img src> cannot carry — and serving
 * them from a public URL instead would make internal documentation shareable
 * by anyone who copied the link. Callers must revoke the URL when done.
 */
export async function authedBlobUrl(path: string): Promise<string> {
  const token = getToken()
  const response = await fetch(`${BASE}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) {
    if (response.status === 401) setToken(null)
    throw new ApiError(`Не удалось загрузить файл (${response.status})`, response.status)
  }
  return URL.createObjectURL(await response.blob())
}
