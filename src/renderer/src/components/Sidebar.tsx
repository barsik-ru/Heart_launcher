import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { LogOut, Copy, Check } from 'lucide-react'
import { brand } from '@shared/config/brand'
import type { ServerStatus } from '@shared/types'
import { useAppStore } from '../stores/app-store'
import { useTranslation } from '../i18n/use-translation'
import { services } from '../services/container'
import { HeartMark } from './HeartMark'
import { NavGlyph } from './NavGlyph'
import { SkinViewer } from './SkinViewer'

const nav = [
  { to: '/', key: 'home' as const, glyph: 'home' as const },
  { to: '/news', key: 'news' as const, glyph: 'news' as const },
  { to: '/modpack', key: 'modpack' as const, glyph: 'modpack' as const },
  { to: '/profile', key: 'profile' as const, glyph: 'profile' as const },
  { to: '/settings', key: 'settings' as const, glyph: 'settings' as const }
]

const SERVER_REFRESH_INTERVAL = 2500
const SERVER_ADDRESS = `${brand.server.host}:${brand.server.port}`

export function Sidebar() {
  const t = useTranslation()
  const profile = useAppStore(state => state.profile)
  const setProfile = useAppStore(state => state.setProfile)
  const settingsDirty = useAppStore(state => state.settingsDirty)
  const setSettingsDirty = useAppStore(state => state.setSettingsDirty)
  const setSettings = useAppStore(state => state.setSettings)
  const [server, setServer] = useState<ServerStatus | null>(null)
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const [addressCopied, setAddressCopied] = useState(false)
  const copyFeedbackTimer = useRef<number | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const currentServerAddress = server?.address ?? SERVER_ADDRESS

  useEffect(() => {
    return () => {
      if (copyFeedbackTimer.current !== null) {
        window.clearTimeout(copyFeedbackTimer.current)
      }
    }
  }, [])

  useEffect(() => {
    let active = true
    let refreshing = false

    const refreshStatus = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const nextStatus = await services.server.getStatus()
        if (active) setServer(nextStatus)
      } catch {
      } finally {
        refreshing = false
      }
    }

    void refreshStatus()
    const interval = window.setInterval(() => {
      void refreshStatus()
    }, SERVER_REFRESH_INTERVAL)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  const confirmLeavingSettings = (): boolean => {
    if (!settingsDirty) return true
    const leave = window.confirm(t.confirmLeave)
    if (leave) {
      setSettingsDirty(false)
      void services.settings.getSettings().then(setSettings).catch(() => undefined)
    }
    return leave
  }

  const logout = async () => {
    if (logoutBusy || !confirmLeavingSettings()) return
    setLogoutBusy(true)
    setLogoutError('')
    try {
      await services.auth.logout()
      setProfile(null)
      navigate('/login', { replace: true })
    } catch {
      setLogoutError(t.tr('Не удалось завершить сеанс.', 'Could not end the session.'))
    } finally {
      setLogoutBusy(false)
    }
  }

  const copyAddress = async () => {
    try {
      let copied = false
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(currentServerAddress)
          copied = true
        } catch {
          copied = false
        }
      }
      if (!copied) {
        const field = document.createElement('textarea')
        field.value = currentServerAddress
        field.setAttribute('readonly', '')
        field.style.position = 'fixed'
        field.style.opacity = '0'
        document.body.appendChild(field)
        field.select()
        copied = document.execCommand('copy')
        field.remove()
      }
      if (!copied) throw new Error('Clipboard is unavailable')
      setAddressCopied(true)
      if (copyFeedbackTimer.current !== null) {
        window.clearTimeout(copyFeedbackTimer.current)
      }
      copyFeedbackTimer.current = window.setTimeout(() => {
        setAddressCopied(false)
        copyFeedbackTimer.current = null
      }, 1600)
    } catch {
      setAddressCopied(false)
    }
  }

  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <div className="brand-mark"><HeartMark /></div>
        <div className="brand-name">{brand.name}</div>
      </div>

      <nav aria-label={t.tr('Основная навигация', 'Main navigation')}>
        {nav.map(({ to, key, glyph }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={event => {
              if (to !== location.pathname && !confirmLeavingSettings()) {
                event.preventDefault()
              }
            }}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <NavGlyph name={glyph} className="nav-glyph" />
            <span>{t[key]}</span>
          </NavLink>
        ))}
      </nav>

      {/* Карточка сервера */}
      <section className="server-mini" aria-label={t.tr('Статус сети серверов', 'Server status')}>
        <div className="server-mini-top">
          <span>{t.serverWorld}</span>
          <span className={`server-live ${server ? (server.online ? '' : 'is-offline') : 'is-pending'}`}>
            {server ? (server.online ? t.online : t.offline) : t.checking}
          </span>
        </div>

        {/* Компактный ряд игроков: 0 / 35 онлайн */}
        <div className="server-population">
          <div className="server-population-numbers">
            <strong className="server-mini-number">
              {server ? (server.online ? server.players : 0) : '—'}
            </strong>
            <span className="server-population-slash">/</span>
            <span className="server-population-total">
              {server?.capacity || '—'}
            </span>
          </div>
          <span className="server-population-label">{t.tr('онлайн', 'online')}</span>
        </div>

        <div
          className="server-meter"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={server?.capacity ?? 0}
          aria-valuenow={server?.online ? server.players : 0}
        >
          <span
            style={{
              width: `${server?.online && server.capacity
                ? Math.min(100, (server.players / server.capacity) * 100)
                : 0}%`
            }}
          />
        </div>

        <div className="server-address-row">
          <div className="server-address-copy">
            <span>{t.serverAddress}</span>
            <code title={currentServerAddress}>{currentServerAddress}</code>
          </div>
          <button
            type="button"
            onClick={() => void copyAddress()}
            aria-label={t.copyAddress}
            title={addressCopied ? t.addressCopied : t.copyAddress}
            className={addressCopied ? 'copied' : ''}
          >
            {addressCopied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
      </section>

      <div className="sidebar-bottom">
        <div className="sidebar-version">
          <span>{t.launcherVersion}</span>
          <code>{brand.version}</code>
        </div>

        {profile && (
          <div className="user-mini">
            <div className="user-mini-row">
              <Link
                className="user-mini-profile"
                to="/profile"
                onClick={event => {
                  if (location.pathname !== '/profile' && !confirmLeavingSettings()) {
                    event.preventDefault()
                  }
                }}
              >
                <div
                  className="avatar-small"
                  style={{
                    overflow: 'hidden',
                    padding: 0,
                    width: '29px',
                    height: '29px',
                    borderRadius: '4px',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-raised)',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0
                  }}
                >
                  <SkinViewer skinUrl={profile.skinUrl} mode="head" width={29} height={29} />
                </div>

                <div className="user-mini-info">
                  <b>{profile.username}</b>
                  <span>{profile.group}</span>
                </div>
              </Link>
              <button
                className="user-mini-logout"
                type="button"
                onClick={() => void logout()}
                disabled={logoutBusy}
                aria-label={t.logout}
                title={t.logout}
              >
                <LogOut size={15} />
                <span>{logoutBusy ? '...' : t.logout}</span>
              </button>
            </div>
            {logoutError && <span className="user-mini-error" role="alert">{logoutError}</span>}
          </div>
        )}
      </div>
    </aside>
  )
}