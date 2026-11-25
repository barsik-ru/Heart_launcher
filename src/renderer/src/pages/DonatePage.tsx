import { useState } from 'react'
import { Check, Copy, Crown, ExternalLink, MessageSquare, Package, ShieldCheck } from 'lucide-react'
import { SectionHeading } from '../components/SectionHeading'
import { useTranslation } from '../i18n/use-translation'

const DISCORD_INVITE_URL = 'https://discord.gg/heartru'

async function copyTextSafe(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fallback below
    }
  }
  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const ok = document.execCommand('copy')
    field.remove()
    return ok
  } catch {
    return false
  }
}

export function DonatePage() {
  const t = useTranslation()
  const [copied, setCopied] = useState(false)

  const openDiscord = async () => {
    try {
      if (window.launcher?.system.openDiscord) {
        await window.launcher.system.openDiscord()
        return
      }
    } catch {
      // fallback to browser window.open
    }
    window.open(DISCORD_INVITE_URL, '_blank', 'noopener,noreferrer')
  }

  const handleCopy = async () => {
    const ok = await copyTextSafe(DISCORD_INVITE_URL)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <div className="donate-page">
      <SectionHeading
        title={t.tr('Донат и поддержка проекта', 'Store & Support')}
        description={t.tr(
          'Приобрести привилегии и наборы можно только на нашем официальном Discord-сервере.',
          'Ranks and kits can only be purchased on our official Discord server.'
        )}
      />

      <section className="donate-discord-hero">
        <div className="donate-discord-copy">
          <div className="donate-discord-tag">
            <MessageSquare size={15} />
            <span>{t.tr('ПОКУПКА ТОЛЬКО В DISCORD', 'DISCORD ONLY')}</span>
          </div>

          <h2>{t.tr('Покупка доната доступна только в Discord', 'Donations are available in Discord only')}</h2>
          <p>
            {t.tr(
              'В лаунчере встроенная оплата отключена. Чтобы поддержать сервер Heart и получить привилегию или стартовый набор, перейди в наш Discord-сервер — там ты найдёшь актуальный список, цены и оформление через администрацию.',
              'Built-in checkout is disabled in the launcher. Join our Discord server to view available ranks and kits and arrange a purchase with an admin.'
            )}
          </p>

          <div className="donate-discord-actions">
            <button type="button" className="primary-button donate-discord-btn" onClick={() => void openDiscord()}>
              <ExternalLink size={16} />
              {t.tr('Перейти в Discord', 'Open Discord')}
            </button>

            <button type="button" className="outline-button donate-copy-btn" onClick={() => void handleCopy()}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied
                ? t.tr('Ссылка скопирована', 'Link copied')
                : t.tr('Скопировать ссылку', 'Copy invite link')}
            </button>
          </div>

          <div className="donate-discord-link-row">
            <span>{t.tr('Приглашение:', 'Invite link:')}</span>
            <code>{DISCORD_INVITE_URL}</code>
          </div>
        </div>
      </section>

      <div className="donate-info-grid">
        <article className="donate-info-card">
          <div className="donate-card-icon">
            <Crown size={18} />
          </div>
          <h3>{t.tr('Привилегии без дисбаланса', 'Balanced ranks')}</h3>
          <p>
            {t.tr(
              'Статусы VIP и MVP с приятными бонусами, оформлением и поддержкой сервера без «имбовых» предметов.',
              'VIP and MVP ranks with convenient perks and server support, without pay-to-win gear.'
            )}
          </p>
        </article>

        <article className="donate-info-card">
          <div className="donate-card-icon">
            <Package size={18} />
          </div>
          <h3>{t.tr('Полезные наборы', 'Helpful kits')}</h3>
          <p>
            {t.tr(
              'Стартовые, строительные и походные комплекты ресурсов, которые экономят время на старте выживания.',
              'Starter, builder and explorer kits to save time early in survival.'
            )}
          </p>
        </article>

        <article className="donate-info-card">
          <div className="donate-card-icon">
            <ShieldCheck size={18} />
          </div>
          <h3>{t.tr('Быстрая выдача в игре', 'Instant in-game delivery')}</h3>
          <p>
            {t.tr(
              'После подтверждения в Discord администратор выдаёт покупку одной командой. Если ты оффлайн — всё придёт при входе.',
              'Once confirmed in Discord, an admin grants your item immediately — or automatically when you next join.'
            )}
          </p>
        </article>
      </div>
    </div>
  )
}