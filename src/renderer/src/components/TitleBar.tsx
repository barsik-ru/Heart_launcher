import { Minus, Square, X, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from '../i18n/use-translation'

export function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  const t = useTranslation()

  useEffect(() => {
    const bridge = window.launcher?.window
    if (!bridge) return
    void bridge.isMaximized().then(setMaximized).catch(() => undefined)
    return bridge.onMaximized(setMaximized)
  }, [])

  const action = async (name: 'minimize' | 'toggleMaximize' | 'close') => {
    await window.launcher?.window.action(name)
  }

  return (
    <header className="titlebar">
      <div className="titlebar-drag-space" aria-hidden="true" />
      <div className="window-actions">
        <button aria-label={t.minimize} onClick={() => void action('minimize')}>
          <Minus size={15} />
        </button>
        <button
          aria-label={maximized ? t.restore : t.maximize}
          onClick={() => void action('toggleMaximize')}
        >
          {maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button aria-label={t.close} className="close" onClick={() => void action('close')}>
          <X size={16} />
        </button>
      </div>
    </header>
  )
}
