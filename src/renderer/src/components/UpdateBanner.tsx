import { useEffect, useRef, useState } from 'react'
import { Download, RefreshCw, RotateCw, X } from 'lucide-react'
import type { AppUpdateProgress, AppUpdateStatus } from '@shared/types'
import { services } from '../services/container'

export function UpdateBanner() {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null)
  const [progress, setProgress] = useState<AppUpdateProgress | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [installQueued, setInstallQueued] = useState(false)
  const autoDownloadStarted = useRef(false)

  useEffect(() => {
    let active = true

    const handleState = (next: AppUpdateStatus) => {
      if (!active) return
      setStatus(next)

      if (next.state === 'available' && !autoDownloadStarted.current) {
        autoDownloadStarted.current = true
        setDismissed(false)
        void services.updater.downloadUpdate().catch(() => undefined)
      }

      if (next.state === 'downloaded') {
        setDismissed(false)
      }
    }

    const offState = services.updater.onStateChange(handleState)
    const offProgress = services.updater.onProgress(nextProgress => {
      if (active) setProgress(nextProgress)
    })

    void services.updater.getStatus().then(handleState).catch(() => undefined)
    void services.updater.checkForUpdates().then(handleState).catch(() => undefined)

    return () => {
      active = false
      offState()
      offProgress()
    }
  }, [])

  useEffect(() => {
    if (installQueued && status?.state === 'downloaded') {
      setInstallQueued(false)
      void services.updater.installUpdate().catch(() => undefined)
    }
  }, [installQueued, status?.state])

  if (!status || dismissed) return null
  if (!['available', 'downloading', 'downloaded', 'installing', 'error'].includes(status.state)) {
    return null
  }
  if (status.state === 'error' && !status.availableVersion) {
    return null
  }

  const percent = progress?.percent ?? status.progress ?? 0
  const speedMb = progress && progress.bytesPerSecond > 0
    ? ` · ${(progress.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`
    : ''

  const handleAction = () => {
    if (status.state === 'downloaded') {
      void services.updater.installUpdate().catch(() => undefined)
    } else if (status.state === 'available' || status.state === 'error') {
      setInstallQueued(true)
      void services.updater.downloadUpdate().catch(() => setInstallQueued(false))
    } else if (status.state === 'downloading') {
      setInstallQueued(prev => !prev)
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: '48px',
        right: '20px',
        zIndex: 9500,
        width: 'min(430px, calc(100vw - 40px))',
        padding: '12px 14px',
        background: 'var(--surface-raised)',
        border: '1px solid var(--accent)',
        boxShadow: '0 10px 28px rgba(0, 0, 0, 0.55)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        WebkitAppRegion: 'no-drag'
      } as React.CSSProperties}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ color: 'var(--accent)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          {status.state === 'downloading' || status.state === 'installing'
            ? <RefreshCw size={16} className="button-spinner" />
            : <Download size={16} />}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: 'block', fontSize: '13px', color: 'var(--text)' }}>
            {status.state === 'downloaded'
              ? `Обновление v${status.availableVersion} готово`
              : status.state === 'installing'
                ? 'Установка обновления...'
                : status.state === 'error'
                  ? 'Ошибка обновления'
                  : `Доступно обновление v${status.availableVersion}`}
          </strong>
          <small style={{ display: 'block', fontSize: '11px', color: status.state === 'error' ? 'var(--danger)' : 'var(--muted)' }}>
            {status.state === 'downloading'
              ? `Загрузка в папку лаунчера: ${percent}%${speedMb}`
              : status.state === 'downloaded'
                ? `Текущая: v${status.currentVersion} → Новая: v${status.availableVersion}`
                : status.state === 'error'
                  ? status.error
                  : `Текущая версия: v${status.currentVersion}`}
          </small>
        </div>

        <button
          type="button"
          className="primary-button"
          onClick={handleAction}
          disabled={status.state === 'installing'}
          style={{ height: '30px', padding: '0 10px', fontSize: '11px', flexShrink: 0 }}
        >
          <RotateCw size={13} />
          {status.state === 'downloaded'
            ? 'Установить'
            : status.state === 'downloading'
              ? (installQueued ? 'Ждём…' : 'Сразу поставить')
              : status.state === 'error'
                ? 'Повторить'
                : 'Обновить'}
        </button>

        {status.state !== 'installing' && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Скрыть"
            style={{
              background: 'transparent',
              border: 0,
              color: 'var(--muted)',
              cursor: 'pointer',
              padding: '4px',
              display: 'grid',
              placeItems: 'center'
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {status.state === 'downloading' && (
        <div style={{ height: '4px', background: 'var(--panel-2)', overflow: 'hidden' }}>
          <div style={{ width: `${percent}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.15s ease' }} />
        </div>
      )}
    </div>
  )
}