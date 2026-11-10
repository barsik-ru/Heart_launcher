import { describe, expect, it } from 'vitest'
import { isTrustedRendererUrl } from '../src/main/security/navigation'

describe('renderer sender policy', () => {
  it('allows only the configured development origins', () => {
    expect(isTrustedRendererUrl('http://localhost:5173/', false)).toBe(true)
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/', false)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5174/', false)).toBe(false)
    expect(isTrustedRendererUrl('https://localhost:5173/', false)).toBe(false)
  })

  it('accepts only the packaged renderer entry file', () => {
    expect(isTrustedRendererUrl('file:///C:/Program%20Files/Verdant/out/renderer/index.html', true)).toBe(true)
    expect(isTrustedRendererUrl('file:///C:/Users/Player/secrets.txt', true)).toBe(false)
    expect(isTrustedRendererUrl('https://example.com', true)).toBe(false)
  })
})
