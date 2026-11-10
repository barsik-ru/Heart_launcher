import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, CirclePause, Download, FileCheck2, Play, TerminalSquare } from 'lucide-react'
import { Link } from 'react-router-dom'
import { SectionHeading } from '../components/SectionHeading'
import { services } from '../services/container'
import { useAppStore } from '../stores/app-store'
import type { GameLogEvent, ProgressEvent } from '@shared/types'
import { useTranslation } from '../i18n/use-translation'
import { localizeError } from '../i18n/localize-content'

export function InstallationPage() {
  const t = useTranslation()
  const locale = t.locale === 'en' ? 'en-US' : 'ru-RU'
  const status = useAppStore(state => state.launcher)
  const setStatus = useAppStore(state => state.setLauncher)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [logs, setLogs] = useState<GameLogEvent[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void services.launcher.getStatus().then(value => { if (active) { setStatus(value); setProgress(value.progress) } })
    const offProgress = services.launcher.onProgress(setProgress)
    const offLog = services.launcher.onLog(entry => setLogs(current => [...current.slice(-119), entry]))
    const offState = services.launcher.onStateChange(setStatus)
    return () => { active = false; offProgress(); offLog(); offState() }
  }, [setStatus])

  const run = async (kind: 'install' | 'update' | 'verify' | 'launch') => {
    setError('')
    try {
      if (kind === 'install') await services.launcher.install()
      if (kind === 'update') await services.launcher.update()
      if (kind === 'verify') await services.launcher.verifyFiles()
      if (kind === 'launch') await services.launcher.launch()
    } catch (cause) {
      setError(cause instanceof Error ? localizeError(cause.message, t.locale) : t.operationFailed)
    }
  }

  const copyLogs = () => {
    const report = logs.map(entry => `${new Date(entry.timestamp).toLocaleTimeString(locale)} [${entry.level}] [${entry.source}] ${localizeError(entry.message, t.locale)}`).join('\n')
    void navigator.clipboard?.writeText(report).then(() => setError(t.diagnosticCopied)).catch(() => setError(t.diagnosticCopyFailed))
  }

  const active = ['checking', 'downloading', 'verifying', 'installing', 'launching', 'running'].includes(status.state)
  const percent = progress?.processedBytes !== undefined && progress.totalBytes > 0
    ? Math.min(100, Math.round((progress.processedBytes / progress.totalBytes) * 100))
    : progress?.progress ?? 0
  const remainingBytes = progress ? progress.totalBytes - (progress.processedBytes ?? progress.downloadedBytes) : 0
  const etaSeconds = progress && progress.downloadSpeed > 0 && remainingBytes > 0 ? Math.ceil(remainingBytes / progress.downloadSpeed) : null
  const etaLabel = etaSeconds === null ? '—' : etaSeconds >= 60
    ? `${Math.floor(etaSeconds / 60)} ${t.minutes} ${etaSeconds % 60} ${t.seconds}`
    : `${etaSeconds} ${t.seconds}`
  const stageNames: Record<string, string> = {
    environment: t.environment, java: 'Java 21', files: 'Проверка локального кеша', download: t.download,
    sha256: t.sha256, install: t.installStage, prepare: t.prepare, complete: t.complete
  }
  const statusTitle = active ? t.operationActive : status.state === 'ready' ? t.noOperation : status.state === 'cancelled' ? t.operationCancelled : status.state === 'error' ? t.needsAttention : t.operationWaiting

  return (
    <>
      <SectionHeading title={t.installPageTitle} description={t.installPageDescription} action={<Link className="outline-button" to="/modpack">{t.toModpack}</Link>}/>
      <section className="install-summary panel">
        <div className="install-summary-head"><div className="install-icon"><Activity size={18}/></div><div><h2>{statusTitle}</h2></div></div>
        <div className="install-progress-label"><span>{progress ? stageNames[progress.stage] ?? progress.stage : t.noOperation}</span><strong>{percent}%</strong></div>
        <div className="install-progress-track"><i style={{ width: `${percent}%` }}/></div>
        <div className="install-progress-details">
          <span>{t.progressFile} <code>{progress?.currentFile ?? '—'}</code></span>
          <span>Скачано по сети: {progress && progress.totalBytes ? `${(progress.downloadedBytes / 1024 / 1024).toFixed(1)} MB · ${progress.downloadedFiles ?? 0} файлов` : '0 MB'}</span>
          <span>Из кеша: {progress?.cachedFiles ?? 0} / {progress?.totalFiles ?? 0} файлов ({((progress?.cachedBytes ?? 0) / 1024 / 1024).toFixed(1)} MB)</span>
          {progress && progress.totalFiles !== undefined && progress.totalFiles > 0 && progress.cachedFiles === progress.totalFiles && (progress.downloadedFiles ?? 0) === 0 && <strong style={{ color: 'var(--success, #86b77b)' }}>Все файлы взяты из кеша — повторной загрузки нет.</strong>}
          <span>{t.speed} {progress?.downloadSpeed ? `${(progress.downloadSpeed / 1024 / 1024).toFixed(1)} MB/s` : '—'}</span>
          <span>{t.remaining} {etaLabel}</span>
        </div>
        {status.error && <div className="install-error"><AlertTriangle size={15}/>{localizeError(status.error, t.locale)}</div>}
        {error && <div className="install-error"><AlertTriangle size={15}/>{error}</div>}
        <div className="install-actions">
          <button className="primary-button" disabled={active} onClick={() => void run('launch')}><Play size={15}/>{t.play}</button>
          <button className="outline-button" disabled={active} onClick={() => void run('install')}><Download size={15}/>{t.installAction}</button>
          <button className="outline-button" disabled={active} onClick={() => void run('verify')}><FileCheck2 size={15}/>{t.verifyAction}</button>
          <button className="cancel-operation" disabled={!active || status.state === 'running'} onClick={() => void services.launcher.cancel()}><CirclePause size={15}/>{t.cancelAction}</button>
        </div>
      </section>
      <section className="logs-panel panel">
        <div className="panel-heading"><div><h2><TerminalSquare size={16}/> {t.operationLog}</h2></div><div className="logs-actions"><span>{logs.length} {t.events}</span><button className="outline-button" onClick={copyLogs}>{t.copy}</button><button className="outline-button" onClick={() => setLogs([])}>{t.clear}</button></div></div>
        <div className="logs-list">{logs.length === 0 ? <div className="logs-empty"><CheckCircle2 size={15}/> {t.noLogs}</div> : logs.map((entry, index) => <div className="log-row" key={`${entry.timestamp}-${index}`}><time>{new Date(entry.timestamp).toLocaleTimeString(locale)}</time><b className={`log-level log-${entry.level.toLowerCase()}`}>{entry.level}</b><span>{localizeError(entry.message, t.locale)}</span></div>)}</div>
      </section>
    </>
  )
}