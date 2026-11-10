import fs from 'node:fs'
import path from 'node:path'

function readLocalEnv() {
  const envPath = path.resolve('.env')
  if (!fs.existsSync(envPath)) return {}
  return Object.fromEntries(fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const index = line.indexOf('=')
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')]
    }))
}

const env = { ...readLocalEnv(), ...process.env }

if (env.VITE_USE_MOCKS === 'true') {
  console.error([
    '',
    'Production packaging is disabled while VITE_USE_MOCKS=true.',
    'Set VITE_USE_MOCKS=false before building a distributable.',
    'DEMO authentication and fake game launch are not allowed in production packaging.',
    ''
  ].join('\n'))
  process.exit(1)
}

if (!env.VERDANT_API_BASE_URL) {
  console.warn('VERDANT_API_BASE_URL is empty. The packaged app will start in API OFFLINE mode; set it before building to connect this client to your backend.')
}
