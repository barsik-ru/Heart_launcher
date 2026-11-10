import { useEffect, useState } from 'react'
import { AlertCircle, Blocks, Check, ChevronRight, Download, LoaderCircle, Play } from 'lucide-react'
import { Link } from 'react-router-dom'
import { media } from '@shared/config/media'
import type { InstallationInfo, NewsArticle, ProgressEvent } from '@shared/types'
import { services } from '../services/container'
import { useAppStore } from '../stores/app-store'
import { assetUrl } from '../assets/asset-url'
import { useTranslation } from '../i18n/use-translation'
import { localizeArticle, localizeError } from '../i18n/localize-content'

const FALLBACK_NEWS_COVERS = [
  media.river,
  media.cherry,
  media.hero,
  media.sunset,
  media.mountains,
  media.desert,
  media.valley,
  media.forest
]

function resolveNewsImage(image?: string | null, index = 0): string {
  if (image && image.trim().length > 0) return assetUrl(image)
  return assetUrl(FALLBACK_NEWS_COVERS[index % FALLBACK_NEWS_COVERS.length])
}

function cleanProgressFileName(file?: string): string {
  if (!file) return ''
  if (file.includes('assets/objects') || file.includes('resources.download.minecraft.net')) {
    return 'Ресурсы и звуки игры'
  }
  if (file.startsWith('Mod:')) {
    return file
  }
  if (file.includes('Проверка кеша')) {
    return file
  }
  const name = file.split('/').pop()?.split('\\').pop() ?? file
  return name.length > 45 ? `${name.slice(0, 42)}…` : name
}

export function HomePage() {
  const t = useTranslation()
  const [news, setNews] = useState<NewsArticle[]>([])
  const [newsLoading, setNewsLoading] = useState(true)
  const [installation, setInstallation] = useState<InstallationInfo | null>(null)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [busy, setBusy] = useState(false)
  const [operationError, setOperationError] = useState('')
  const launcher = useAppStore(state => state.launcher)
  const setLauncher = useAppStore(state => state.setLauncher)
  const locale = t.locale === 'en' ? 'en-US' : 'ru-RU'

  useEffect(() => {
    let active = true
    const loadHomeData = async () => {
      const [newsResult, installationResult, launcherResult] = await Promise.allSettled([
        services.news.getNews(),
        services.launcher.getInstallationInfo(),
        services.launcher.getStatus()
      ])
      if (!active) return
      if (newsResult.status === 'fulfilled') setNews(newsResult.value)
      if (installationResult.status === 'fulfilled') setInstallation(installationResult.value)
      if (launcherResult.status === 'fulfilled') {
        setLauncher(launcherResult.value)
        setProgress(launcherResult.value.progress)
      }
      setNewsLoading(false)
    }
    void loadHomeData().catch(() => { if (active) setNewsLoading(false) })
    const offState = services.launcher.onStateChange(next => { setLauncher(next); setProgress(next.progress) })
    const offProgress = services.launcher.onProgress(setProgress)
    return () => { active = false; offState(); offProgress() }
  }, [setLauncher])

  const installed = Boolean(installation?.installed)
  const gameRunning = launcher.state === 'running'
  const isLaunching = launcher.state === 'launching'
  const operationRunning = ['checking', 'downloading', 'verifying', 'installing'].includes(launcher.state)

  const primaryLabel = gameRunning
    ? t.gameRunning
    : isLaunching
      ? launcher.progress?.currentFile || 'Запуск Minecraft...'
      : operationRunning
        ? (launcher.state === 'downloading' ? t.downloadPack : t.operationRunning)
        : !installation
          ? t.gettingInfo
          : !installed
            ? t.tr('Скачать и играть', 'Download & Play')
            : t.play

  const primaryIcon = busy || operationRunning || isLaunching || !installation
    ? <LoaderCircle size={18} className="button-spinner" />
    : gameRunning ? <Check size={18} />
      : !installed ? <Download size={18} />
        : <Play size={18} />

  const primaryAction = async () => {
    if (busy || operationRunning || isLaunching || !installation || gameRunning) return
    setBusy(true)
    setOperationError('')
    try {
      await services.launcher.launch()
      const [nextInstallation, nextStatus] = await Promise.all([
        services.launcher.getInstallationInfo(),
        services.launcher.getStatus()
      ])
      setInstallation(nextInstallation)
      setLauncher(nextStatus)
    } catch (cause) {
      setOperationError(cause instanceof Error ? localizeError(cause.message, t.locale) : t.operationFailed)
    } finally {
      setBusy(false)
    }
  }

  const stageLabels: Record<string, string> = {
    environment: t.environment, java: 'Установка Java 21', files: t.files, download: t.download,
    sha256: t.sha256, install: t.installStage, prepare: t.prepare, complete: t.complete
  }
  const stageLabel = progress ? stageLabels[progress.stage] ?? progress.stage : ''

  const clientState = gameRunning
    ? t.gameRunning
    : isLaunching
      ? launcher.progress?.currentFile || 'Инициализация окна Minecraft...'
      : operationRunning
        ? (launcher.state === 'downloading' ? t.downloadPack : t.operationRunning)
        : !installation
          ? t.gettingInfo
          : !installed
            ? t.buildNotInstalled
            : t.ready

  const canRunOperation = Boolean(installation && !operationRunning && !isLaunching && !gameRunning)

  const categoryLabel = (category: string) => ({
    'Обновления': t.tr('Обновления', 'Updates'),
    'События': t.tr('События', 'Events'),
    'Объявления': t.tr('Объявления', 'Announcements'),
    'Технические работы': t.tr('Технические работы', 'Maintenance')
  }[category] ?? category)

  return (
    <div className="home-page">
      <section className="hero-card">
        <div className="hero-image" style={{ backgroundImage: `url("${assetUrl(media.hero)}")` }} />
        <div className="hero-shade" />
        <div className="hero-content">
          <h1 className="hero-title">
            <span>{t.locale === 'en' ? 'Join' : 'Подключайся'}</span>
            <span>{t.locale === 'en' ? 'Heart' : 'к Heart'}</span>
          </h1>
          <div className="hero-actions" style={{ marginTop: '24px' }}>
            <button className="primary-button home-primary-action" onClick={() => void primaryAction()} disabled={busy || !canRunOperation}>
              {primaryIcon}{busy ? t.doing : primaryLabel}
            </button>
            <Link className="hero-secondary" to="/modpack">{t.whatInside}<ChevronRight size={16} /></Link>
          </div>
        </div>
      </section>

      {operationRunning && progress && (
        <section className="home-operation" aria-live="polite">
          <div>
            <strong>{stageLabel} · {progress.progress}%</strong>
            <small>{cleanProgressFileName(progress.currentFile)}</small>
          </div>
          <div className="operation-meter"><i style={{ width: `${progress.progress}%` }} /></div>
          <button className="text-button" onClick={() => void services.launcher.cancel()}>{t.cancel}</button>
        </section>
      )}

      {(operationError || launcher.state === 'error') && (
        <div className="home-error" role="alert">
          <AlertCircle size={16} />{operationError || (launcher.error ? localizeError(launcher.error, t.locale) : t.operationError)}
        </div>
      )}

      <section className="client-summary" aria-live="polite">
        <div className="client-summary-version">
          <span className="client-summary-symbol"><Blocks size={20} /></span>
          <div><span className="client-summary-label">{t.installedPack}</span><strong>{installed ? 'Minecraft 1.21.11' : t.packNotInstalled}</strong></div>
        </div>
        <div className="client-summary-game">
          <span>{t.minecraftJava}</span><strong>1.21.11</strong>
          <span>Сервер</span><strong>87.228.56.12:25565</strong>
        </div>
        <div className={`client-summary-state ${installed ? 'is-installed' : ''}`}>
          <span className="client-state-indicator">{installed ? <Check size={15}/> : <Download size={15}/>}</span>
          <span>{clientState}</span>
        </div>
      </section>

      <section className="home-news-section">
        <div className="section-row"><h2>{t.latestChanges}</h2><Link to="/news" className="inline-link">{t.allPosts}<ChevronRight size={15}/></Link></div>
        {newsLoading ? (
          <div className="news-grid-equal" aria-label={t.loadingPosts} aria-busy="true">
            <div className="news-card-equal" style={{ opacity: 0.6 }} />
            <div className="news-card-equal" style={{ opacity: 0.6 }} />
          </div>
        ) : news.length === 0 ? (
          <div className="empty-state"><span>{t.noPostsService}</span></div>
        ) : (
          <div className="news-grid-equal">
            {news.slice(0, 2).map((sourceItem, idx) => {
              const item = localizeArticle(sourceItem, t.locale)
              return (
                <Link to={`/news/${item.id}`} className="news-card-equal" key={item.id}>
                  <div className="news-thumb-equal" style={{ backgroundImage: `url("${resolveNewsImage(item.image, idx)}")` }}/>
                  <div className="news-card-content-equal">
                    <div className="news-meta"><span>{categoryLabel(item.category)}</span><time>{new Date(item.date).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' })}</time></div>
                    <h3>{item.title}</h3>
                    <p>{item.excerpt}</p>
                    <span className="news-read">{t.openPost}<ChevronRight size={14}/></span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}