export class BackendApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string = 'BACKEND_ERROR'
  ) {
    super(message)
    this.name = 'BackendApiError'
  }
}

/** True only when HeartBridge explicitly says the refresh/access session is invalid. */
export function isDefinitiveSessionInvalidationError(cause: unknown): boolean {
  return cause instanceof BackendApiError && cause.status === 401 && cause.code === 'AUTH_SESSION_INVALID'
}

export interface BackendRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  accessToken?: string
  timeoutMs?: number
}

export function normalizeApiBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('VERDANT_API_BASE_URL должен быть корректным URL.')
  }
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost)) {
    throw new Error('Backend API должен использовать HTTPS. HTTP разрешён только для localhost.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('URL backend API не должен содержать логин, пароль, query или hash.')
  }
  return `${url.toString().replace(/\/+$/, '')}/`
}

export class BackendApiClient {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = normalizeApiBaseUrl(baseUrl)
  }

  async request<T>(path: string, options: BackendRequestOptions = {}): Promise<T> {
    const cleanPath = path.replace(/^\/+/, '')
    if (!cleanPath || cleanPath.split('/').some(segment => segment === '..')) {
      throw new Error('Недопустимый путь API.')
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000)
    try {
      const headers = new Headers({ Accept: 'application/json' })
      if (options.body !== undefined) headers.set('Content-Type', 'application/json')
      if (options.accessToken) headers.set('Authorization', `Bearer ${options.accessToken}`)
      const response = await fetch(new URL(cleanPath, this.baseUrl), {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        redirect: 'error',
        cache: 'no-store'
      })
      const contentType = response.headers.get('content-type') ?? ''
      let payload: unknown = null
      if (contentType.includes('application/json')) {
        try { payload = await response.json() } catch { payload = null }
      }
      if (!response.ok) {
        const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
        const error = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : record
        const message = typeof error.message === 'string' ? error.message.slice(0, 500) : `Backend вернул HTTP ${response.status}.`
        const code = typeof error.code === 'string' ? error.code.slice(0, 80) : 'BACKEND_ERROR'
        throw new BackendApiError(message, response.status, code)
      }
      return payload as T
    } catch (cause) {
      if (cause instanceof BackendApiError) throw cause
      if (controller.signal.aborted) throw new BackendApiError('Backend API не ответил вовремя.', 408, 'BACKEND_TIMEOUT')
      throw new BackendApiError('Не удалось связаться с backend API. Проверьте подключение и адрес сервера.', 0, 'BACKEND_UNAVAILABLE')
    } finally {
      clearTimeout(timeout)
    }
  }
}
