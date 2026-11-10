import type { NewsService } from '../../shared/contracts/services'
import { fetchHeartBridgeNews } from './heart-bridge-client'

export function createHeartBridgeNewsService(baseUrl: string): NewsService {
  let cached: Awaited<ReturnType<typeof fetchHeartBridgeNews>> | null = null
  let cacheUntil = 0
  let pending: Promise<Awaited<ReturnType<typeof fetchHeartBridgeNews>>> | null = null

  const load = async () => {
    if (cached && Date.now() < cacheUntil) return cached
    if (!pending) {
      pending = fetchHeartBridgeNews(baseUrl)
        .then(rows => {
          cached = rows
          cacheUntil = Date.now() + 30_000
          return rows
        })
        .finally(() => { pending = null })
    }
    return pending
  }

  return {
    async getNews() { return load() },
    async getArticle(id) { return (await load()).find(article => article.id === id) ?? null }
  }
}
