import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight, CalendarDays } from 'lucide-react'
import type { NewsArticle } from '@shared/types'
import { media } from '@shared/config/media'
import { services } from '../services/container'
import { SectionHeading } from '../components/SectionHeading'
import { assetUrl } from '../assets/asset-url'
import { useTranslation } from '../i18n/use-translation'
import { localizeArticle } from '../i18n/localize-content'

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

function NewsLoadingSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return <div className="news-loading-list" aria-label={label} aria-busy="true">
    {Array.from({ length: rows }, (_, index) => <div className="news-loading-row" key={index}><span className="news-loading-image"/><span className="news-loading-copy"><i/><b/><em/><small/></span></div>)}
  </div>
}

export function NewsPage() {
  const t = useTranslation()
  const [items, setItems] = useState<NewsArticle[]>([])
  const [selected, setSelected] = useState<NewsArticle | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadedRoute, setLoadedRoute] = useState<string | null>(null)
  const { id } = useParams()
  const routeKey = id ?? 'news-index'
  const locale = t.locale === 'en' ? 'en-US' : 'ru-RU'

  const categoryLabel = (category: string) => ({
    'Обновления': t.tr('Обновления', 'Updates'),
    'События': t.tr('События', 'Events'),
    'Объявления': t.tr('Объявления', 'Announcements'),
    'Технические работы': t.tr('Технические работы', 'Maintenance')
  }[category] ?? category)

  const formatArticleDate = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  }

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadedRoute(null)
    if (id) {
      void services.news.getArticle(id).then(article => { if (active) setSelected(article) })
        .catch(() => { if (active) setSelected(null) })
        .finally(() => { if (active) { setLoadedRoute(routeKey); setLoading(false) } })
    } else {
      setSelected(null)
      void services.news.getNews().then(articles => { if (active) setItems(articles) })
        .catch(() => { if (active) setItems([]) })
        .finally(() => { if (active) { setLoadedRoute(routeKey); setLoading(false) } })
    }
    return () => { active = false }
  }, [id, routeKey])

  const routeLoading = loading || loadedRoute !== routeKey

  if (id) return <div className="article-page">
    <Link to="/news" className="back-link"><ArrowLeft size={15}/>{t.allNews}</Link>
    {routeLoading ? <NewsLoadingSkeleton rows={1} label={t.loadingPosts}/> : selected ? (() => { const article = localizeArticle(selected, t.locale); return <>
      <div className="article-cover" style={{ backgroundImage: `url("${resolveNewsImage(selected.image)}")` }}/>
      <div className="article-body"><div className="news-meta"><span>{categoryLabel(article.category)}</span><time>{formatArticleDate(article.date)}</time></div><h1>{article.title}</h1><p className="article-lead">{article.excerpt}</p><p>{article.content}</p></div>
    </> })() : <div className="empty-state">{t.articleNotFound}</div>}
  </div>

  return <>
    <SectionHeading title={t.newsPageTitle} description={t.newsPageDescription}/>
    {routeLoading ? <NewsLoadingSkeleton label={t.loadingPosts}/> : items.length === 0 ? <div className="empty-state">{t.newsAfterConnect}</div> : <div className="news-list">
      {items.map((sourceItem, idx) => { const item = localizeArticle(sourceItem, t.locale); return <Link to={`/news/${item.id}`} className="news-list-card" key={item.id}>
        <div className="news-list-image" style={{ backgroundImage: `url("${resolveNewsImage(item.image, idx)}")` }}/>
        <div className="news-list-copy"><div className="news-meta"><span>{item.pinned ? t.pinned : categoryLabel(item.category)}</span><time><CalendarDays size={12}/>{formatArticleDate(item.date)}</time></div><h3>{item.title}</h3><p>{item.excerpt}</p><span className="inline-link">{t.openPublication}<ChevronRight size={14}/></span></div>
      </Link> })}
    </div>}
  </>
}