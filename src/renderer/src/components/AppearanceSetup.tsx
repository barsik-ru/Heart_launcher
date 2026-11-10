import { useState } from 'react'
import { Check } from 'lucide-react'
import { motion } from 'framer-motion'
import type { LauncherSettings } from '@shared/types'
import { services } from '../services/container'
import { useAppStore } from '../stores/app-store'
import { translations } from '../i18n/translations'
import { HeartMark } from './HeartMark'

type ThemeId = LauncherSettings['theme']
type Props = {
  settings: LauncherSettings
  onComplete: (settings: LauncherSettings) => void
}

const THEMES: Array<{ id: ThemeId; color: string; deep: string; name: string }> = [
  { id: 'verdant', color: '#9aba7d', deep: '#17251a', name: 'Heart' },
  { id: 'obsidian', color: '#b8bdca', deep: '#1c1c24', name: 'Обсидиан' },
  { id: 'crimson', color: '#df7e88', deep: '#26151a', name: 'Багровый' },
  { id: 'ocean', color: '#79bfd0', deep: '#13212b', name: 'Океан' },
  { id: 'amethyst', color: '#b69bdd', deep: '#1e162a', name: 'Аметист' }
]

export function AppearanceSetup({ settings, onComplete }: Props) {
  const [theme, setTheme] = useState<ThemeId>(settings.theme)
  const [language, setLanguage] = useState<LauncherSettings['language']>(settings.language)
  const [animations, setAnimations] = useState(settings.animations)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const setGlobalSettings = useAppStore(state => state.setSettings)

  const t = translations[language]
  const currentThemeObj = THEMES.find(th => th.id === theme) || THEMES[0]

  const complete = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const next = await services.settings.updateSettings({
        theme,
        language,
        animations,
        setupComplete: true
      })
      setGlobalSettings(next)
      onComplete(next)
    } catch {
      setError(t.settingsSaveFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="appearance-setup-backdrop" role="presentation">
      <motion.section
        className="appearance-setup"
        role="dialog"
        aria-modal="true"
        style={{
          border: `2px solid ${currentThemeObj.color}`,
          borderRadius: '0px'
        }}
        initial={animations ? { opacity: 0, y: 8 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        <div className="appearance-setup-topline">
          <span
            className="appearance-setup-mark"
            style={{
              color: currentThemeObj.color,
              borderColor: currentThemeObj.color,
              borderRadius: '0px'
            }}
          >
            <HeartMark style={{ width: 18, height: 18 }} />
          </span>
          <span style={{ color: currentThemeObj.color, fontSize: '13px', fontWeight: 700 }}>
            НАСТРОЙКА ОФОРМЛЕНИЯ
          </span>
        </div>

        <header style={{ margin: '14px 0 16px' }}>
          <h1 style={{ fontSize: '20px', margin: '0 0 5px', color: 'var(--text)' }}>ВЫБЕРИТЕ ТЕМУ</h1>
          <p style={{ fontSize: '11px', color: 'var(--muted)', margin: 0 }}>
            Цветовая палитра лаунчера. Её всегда можно изменить в настройках.
          </p>
        </header>

        {/* Сетка тем с цветными квадратными блоками */}
        <div className="appearance-theme-grid">
          {THEMES.map(item => {
            const isSelected = theme === item.id
            return (
              <button
                type="button"
                key={item.id}
                className={`appearance-theme-choice ${isSelected ? 'selected' : ''}`}
                style={{
                  borderColor: isSelected ? item.color : 'var(--border)',
                  background: isSelected ? 'var(--surface-raised)' : 'var(--surface)',
                  borderRadius: '0px'
                }}
                onClick={() => setTheme(item.id)}
              >
                <div
                  className="appearance-theme-swatch"
                  style={{
                    background: `linear-gradient(135deg, ${item.color} 50%, ${item.deep} 50%)`,
                    border: `1px solid ${isSelected ? item.color : 'var(--border)'}`,
                    width: '100%',
                    height: '42px',
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: '0px'
                  }}
                >
                  {isSelected && (
                    <span style={{ background: '#111', color: item.color, padding: '3px', display: 'grid', placeItems: 'center' }}>
                      <Check size={14} />
                    </span>
                  )}
                </div>
                <strong style={{ fontSize: '11px', marginTop: '8px', color: isSelected ? item.color : 'var(--text)' }}>
                  {item.name}
                </strong>
              </button>
            )
          })}
        </div>

        <div className="appearance-setup-bottom" style={{ marginTop: '18px' }}>
          <div className="appearance-setup-language">
            <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px' }}>
              Язык
            </label>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value as 'ru' | 'en')}
              className="theme-select"
              style={{ height: '36px', borderRadius: '0px' }}
            >
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '11px', color: 'var(--muted)', display: 'block', marginBottom: '5px' }}>
              Анимации интерфейса
            </label>
            <button
              type="button"
              className="outline-button"
              style={{
                width: '100%',
                height: '36px',
                padding: '0 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderRadius: '0px',
                cursor: 'pointer'
              }}
              onClick={() => setAnimations(v => !v)}
            >
              <span style={{ fontSize: '11px', color: 'var(--text)' }}>
                {animations ? 'Включены' : 'Выключены'}
              </span>
              <div className={`toggle ${animations ? 'on' : ''}`} style={{ pointerEvents: 'none' }}>
                <span />
              </div>
            </button>
          </div>
        </div>

        {error && <p style={{ color: 'var(--danger)', fontSize: '11px', margin: '10px 0 0' }}>{error}</p>}

        <button
          type="button"
          className="primary-button"
          style={{
            width: '100%',
            height: '44px',
            marginTop: '20px',
            background: currentThemeObj.color,
            borderColor: currentThemeObj.color,
            color: '#111',
            fontWeight: 800,
            fontSize: '13px',
            borderRadius: '0px'
          }}
          disabled={busy}
          onClick={() => void complete()}
        >
          {busy ? 'СОХРАНЕНИЕ…' : 'ГОТОВО'}
        </button>
      </motion.section>
    </div>
  )
}