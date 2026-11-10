export interface AppError {
  code: string
  message: string
  details?: string
  action?: string
  retryable?: boolean
}

export class ServiceUnavailableError extends Error {
  readonly code = 'BACKEND_UNAVAILABLE'

  constructor(message = 'Сервис пока не подключён. Это приложение подготовлено к интеграции с backend API.') {
    super(message)
    this.name = 'ServiceUnavailableError'
  }
}
