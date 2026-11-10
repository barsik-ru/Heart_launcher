import { useEffect, useState } from 'react'
import { FlaskConical, Wifi, WifiOff } from 'lucide-react'
import { isMockMode } from '../services/container'
import { useTranslation } from '../i18n/use-translation'

type ServiceMode = 'demo' | 'backend' | 'offline'

export function MockBadge() {
  const t = useTranslation()
  const [mode, setMode] = useState<ServiceMode>(isMockMode ? 'demo' : 'offline')

  useEffect(() => {
    let active = true
    void window.launcher?.system.getAppInfo().then(info => { if (active) setMode(info.serviceMode) }).catch(() => undefined)
    return () => { active = false }
  }, [])

  if (mode === 'demo') return <span className="mock-badge"><FlaskConical size={12}/>{t.demoLabel}</span>
  if (mode === 'backend') return <span className="mock-badge mock-badge-online"><Wifi size={12}/>{t.apiConfigured}</span>
  return <span className="mock-badge mock-badge-offline"><WifiOff size={12}/>{t.apiOffline}</span>
}
