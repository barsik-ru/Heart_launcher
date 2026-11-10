/** Resolve a public asset against the renderer document, including packaged file:// builds. */
export function assetUrl(path: string): string {
  const normalized = path.replace(/^\/+/, '')
  return new URL(normalized, document.baseURI).toString()
}
