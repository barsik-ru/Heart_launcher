import { describe, expect, it } from 'vitest'
import { BackendApiError, isDefinitiveSessionInvalidationError } from '../src/main/services/backend-api-client'

describe('Heart session invalidation policy', () => {
  it('clears a session only for the explicit invalid/expired session response', () => {
    expect(isDefinitiveSessionInvalidationError(new BackendApiError('Истекла', 401, 'AUTH_SESSION_INVALID'))).toBe(true)
  })

  it('does not treat missing bearer headers as proof that the saved refresh session is invalid', () => {
    expect(isDefinitiveSessionInvalidationError(new BackendApiError('Требуется авторизация', 401, 'AUTH_REQUIRED'))).toBe(false)
  })

  it('preserves the Heart session during skin-service, rate-limit, network and server failures', () => {
    expect(isDefinitiveSessionInvalidationError(new BackendApiError('MineSkin недоступен', 502, 'SKIN_GENERATION_FAILED'))).toBe(false)
    expect(isDefinitiveSessionInvalidationError(new BackendApiError('Повторите позже', 503, 'SERVICE_UNAVAILABLE'))).toBe(false)
    expect(isDefinitiveSessionInvalidationError(new BackendApiError('Слишком часто', 429, 'RATE_LIMITED'))).toBe(false)
    expect(isDefinitiveSessionInvalidationError(new BackendApiError('Сеть недоступна', 0, 'BACKEND_UNAVAILABLE'))).toBe(false)
  })
})
