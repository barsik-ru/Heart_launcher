import { useEffect, useState } from 'react'
import {
  AlertCircle,
  ArrowDownToLine,
  Check,
  Download,
  FileCheck2,
  Package,
  Plus,
  RefreshCw,
  ScrollText,
  ShieldCheck
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { SectionHeading } from '../components/SectionHeading'
import { media } from '@shared/config/media'
import { assetUrl } from '../assets/asset-url'
import { services, isLauncherAvailable } from '../services/container'
import type { InstallationInfo, ProgressEvent } from '@shared/types'
import { useAppStore } from '../stores/app-store'
import { useTranslation } from '../i18n/use-translation'
import { localizeError } from '../i18n/localize-content'

const ACTIVE_STATES = ['checking', 'downloading', 'verifying', 'installing', 'launching']

export function ModpackPage() {
  const t = useTranslation()
  const language = t.locale
  const locale = language === 'en' ? 'en-US' : 'ru-RU'
  const [info, setInfo] = useState<InstallationInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [error, setError] = useState('')
  const status = useAppStore(state => state.launcher)
  const setStatus = useAppStore(state => state.setLauncher)

  useEffect(() => {
    let active = true
    void services.launcher.getInstallationInfo()
      .then(value => { if (active) setInfo(value) })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? localizeError(cause.message, language) : language === 'en' ? 'Could not retrieve modpack details.' : 'Не удалось получить сведения о сборке.')
      })
      .finally(() => { if (active) setLoading(false) })

    const offState = services.launcher.onStateChange(value => {
      setStatus(value)
      setProgress(value.progress)
    })
    const offProgress = services.launcher.onProgress(setProgress)

    return () => {
      active = false
      offState()
      offProgress()
    }
  }, [setStatus, language])

  const act = async (operation: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')

    try {
      await operation()
      setInfo(await services.launcher.getInstallationInfo())
    } catch (cause) {
      setError(cause instanceof Error ? localizeError(cause.message, t.locale) : t.operationFailed)
    } finally {
      setBusy(false)
    }
  }

  const installed = Boolean(info?.installed)
  const installedVersion = info?.installedVersion ?? t.tr('Не установлена', 'Not installed')
  const latestVersion = info?.latestVersion ?? '—'
  const outdated = Boolean(installed && info?.installedVersion !== info?.latestVersion)
  const operationRunning = ACTIVE_STATES.includes(status.state)
  const actionDisabled = loading || !info || busy || operationRunning || !isLauncherAvailable || (!outdated && installed)

  if (loading) {
    return <>
      <SectionHeading title={t.modpackTitle} description={t.modpackDescription} />
      <div className="modpack-loading" aria-label={t.tr('Загрузка сведений о сборке', 'Loading modpack details')} aria-busy="true">
        <div className="modpack-loading-feature" />
        <div className="modpack-loading-status" />
        <div className="modpack-loading-log" />
      </div>
    </>
  }

  return <>
    <SectionHeading title={t.modpackTitle} description={t.modpackDescription} />

    {error && <div className="home-error" role="alert"><AlertCircle size={16} />{error}</div>}

    <div className="modpack-overview">
      <div className="modpack-main-card">
        <div
          className="modpack-card-art"
          style={{ backgroundImage: `linear-gradient(90deg, color-mix(in srgb, var(--bg) 96%, transparent) 0%, color-mix(in srgb, var(--bg) 86%, transparent) 47%, color-mix(in srgb, var(--bg) 22%, transparent)), url("${assetUrl(media.desert)}")` }}
        />
        <div className="modpack-main-copy">
          <div className="version-big">
            <strong>{latestVersion}</strong>
            <span>{t.fabricClient}</span>
          </div>
          <p>{t.tr('Клиент Heart для Minecraft Java Edition', 'The Heart client for Minecraft Java Edition')}</p>
          <div className="version-details">
            <span>Minecraft <b>{info?.minecraftVersion ?? '—'}</b></span>
            <span>Fabric Loader <b>{info?.fabricLoaderVersion ?? '—'}</b></span>
            <span>Java <b>{info?.javaMajorVersion ? `${info.javaMajorVersion}+` : '—'}</b></span>
          </div>
        </div>
      </div>

      <div className="modpack-status-card">
        <div className="status-card-head"><ShieldCheck size={17} /><span>{t.clientFiles}</span></div>

        <div className="file-status">
          <span className={`status-check ${installed ? '' : 'warning'}`}>
            {installed ? <Check size={16} /> : <Package size={16} />}
          </span>
          <div>
            <b>{installed ? t.clientInstalled : t.clientNotInstalled}</b>
            <small>{installedVersion}</small>
          </div>
        </div>

        <div className="file-status">
          <span className={`status-check ${!info || !isLauncherAvailable || outdated ? 'warning' : ''}`}>
            {!info || !isLauncherAvailable ? <AlertCircle size={15} /> : outdated ? <RefreshCw size={15} /> : <Check size={15} />}
          </span>
          <div>
            <b>{!info ? t.infoUnavailable : !isLauncherAvailable ? t.loaderUnavailable : outdated ? t.updateAvailable : installed ? t.latestVersion : t.readyToInstall}</b>
            <small>
              {!info
                ? t.clientFilesStateUnavailable
                : !isLauncherAvailable
                  ? outdated ? t.tr(`Доступна версия ${latestVersion}, но обновление пока недоступно`, `Version ${latestVersion} is available, but updating is not available yet`) : t.updateNotReady
                  : outdated ? `${t.packageSize} ${info.updateSize ?? t.unknown}` : t.filesCanVerify}
            </small>
          </div>
        </div>

        <div className="last-check">
          {t.lastFileCheck} {info?.lastVerified ? new Date(info.lastVerified).toLocaleString(locale) : t.notPerformed}
        </div>
        <button
          className="outline-button full-button"
          disabled={busy || operationRunning || !info || !isLauncherAvailable}
          onClick={() => void act(() => services.launcher.verifyFiles())}
        >
          <FileCheck2 size={15} />{t.verify}
        </button>
      </div>
    </div>

    <div className="changelog-panel">
      <div className="panel-heading">
        <div><h2>{t.changesVersion} {latestVersion}</h2></div>
        <span className="update-size"><ArrowDownToLine size={13} />{info?.updateSize ?? '—'}</span>
      </div>

      <div className="change-columns">
        <div>
          <h4 className="change-added"><Plus size={14} />{t.added}</h4>
          {info?.changes.added.map(item => <p key={item}><span className="change-plus">+</span>{item}</p>)}
        </div>
        <div>
          <h4 className="change-updated"><RefreshCw size={14} />{t.changed}</h4>
          {info?.changes.updated.map(item => <p key={item}><span className="change-dot">↻</span>{item}</p>)}
        </div>
        <div>
          <h4 className="change-removed">{t.removed}</h4>
          {info?.changes.removed.map(item => <p key={item}><span className="change-minus">−</span>{item}</p>)}
        </div>
      </div>

      {!!info?.changes.configurations.length && (
        <div className="config-changes">
          <span>{t.configured}:</span>
          {info.changes.configurations.map(item => <b key={item}>{item === 'Дальность прорисовки' ? t.tr('Дальность прорисовки', 'Render distance') : item === 'Профиль производительности' ? t.tr('Профиль производительности', 'Performance profile') : item}</b>)}
        </div>
      )}
    </div>

    <div className="modpack-footer">
      <div>
        <Package size={16} />
        <span>{isLauncherAvailable ? t.tr('Fabric и клиентские моды загружаются из Modrinth при установке', 'Fabric and client mods are downloaded from Modrinth during installation') : t.loaderUnavailable}</span>
      </div>
      <div className="modpack-footer-actions">
        <Link to="/installation" className="outline-button"><ScrollText size={14} />{t.operationLog}</Link>
        <button
          className="primary-button"
          disabled={actionDisabled}
          onClick={() => void act(() => outdated ? services.launcher.update() : services.launcher.install())}
        >
          {busy || operationRunning
            ? t.doing
            : !info
              ? t.infoUnavailable
              : !isLauncherAvailable
                ? t.loaderUnavailable
              : outdated
                ? t.tr('Обновить сборку', 'Update pack')
                : installed
                  ? t.packInstalled
                  : t.tr('Установить сборку', 'Install pack')}
          {busy || operationRunning
            ? <RefreshCw size={15} />
            : !info || !isLauncherAvailable
              ? <AlertCircle size={15} />
              : outdated
                ? <RefreshCw size={15} />
                : installed
                  ? <Check size={15} />
                  : <Download size={15} />}
        </button>
      </div>
    </div>

    {(progress || error || status.state === 'error') && (
      <div className="inline-progress">
        <div>
          <span>{error || localizeError(status.error ?? '', t.locale) || `${status.state === 'verifying' ? t.tr('Проверка файлов', 'Verifying files') : t.tr('Операция', 'Operation')} · ${progress?.progress ?? 0}%`}</span>
          <span>{progress?.currentFile}</span>
        </div>
        {progress && <div className="progress-track"><i style={{ width: `${progress.progress}%` }} /></div>}
        {progress && <button onClick={() => void services.launcher.cancel()}>{t.tr('Отменить операцию', 'Cancel operation')}</button>}
      </div>
    )}
  </>
}
