import type { WebContents } from 'electron'

const developmentOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])

export function isTrustedRendererUrl(rawUrl: string, packaged: boolean): boolean {
  try {
    const url = new URL(rawUrl)
    if (packaged) return url.protocol === 'file:' && url.pathname.replace(/\\/g, '/').endsWith('/renderer/index.html')
    return developmentOrigins.has(url.origin)
  } catch {
    return false
  }
}

export function hardenNavigation(contents: WebContents, packaged: boolean) {
  contents.on('will-navigate', (event, rawUrl) => {
    if (!isTrustedRendererUrl(rawUrl, packaged)) event.preventDefault()
  })
  contents.on('will-redirect', (event, rawUrl) => {
    if (!isTrustedRendererUrl(rawUrl, packaged)) event.preventDefault()
  })

  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-attach-webview', event => event.preventDefault())
}
