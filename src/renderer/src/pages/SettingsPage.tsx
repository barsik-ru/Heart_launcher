import { useEffect, useState } from 'react'
import {
  FolderOpen, RotateCcw, Monitor, Cpu, Palette, SlidersHorizontal,
  Save, Check, AlertCircle, X
} from 'lucide-react'
import { SectionHeading } from '../components/SectionHeading'
import { services } from '../services/container'
import type { LauncherSettings, SystemMemoryInfo } from '@shared/types'
import { useAppStore } from '../stores/app-store'
import { useTranslation } from '../i18n/use-translation'
import { localizeError } from '../i18n/localize-content'

const THEMES: Array<{ id: LauncherSettings['theme']; color: string; deep: string }> = [
  { id: 'verdant', color: '#9aba7d', deep: '#17251a' },
  { id: 'obsidian', color: '#c0c3ce', deep: '#1b1b22' },
  { id: 'crimson', color: '#e47e85', deep: '#29171d' },
  { id: 'ocean', color: '#78bfd1', deep: '#15242d' },
  { id: 'amethyst', color: '#b89cde', deep: '#241c30' }
]

const sameSettings = (left: LauncherSettings | null, right: LauncherSettings | null) =>
  JSON.stringify(left) === JSON.stringify(right)

export function SettingsPage() {
  const t = useTranslation()
  const [settings, setSettings] = useState<LauncherSettings | null>(null)
  const [savedSettings, setSavedSettings] = useState<LauncherSettings | null>(null)
  const [memory, setMemory] = useState<SystemMemoryInfo | null>(null)
  const [saved, setSaved] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState<string>('performance')
  const setGlobalSettings = useAppStore(state => state.setSettings)
  const setSettingsDirty = useAppStore(state => state.setSettingsDirty)
  const settingsDirty = useAppStore(state => state.settingsDirty)

  // Загружаем настройки только один раз при открытии страницы,
  // чтобы смена языка не вызывала повторное считывание старых данных с диска
  useEffect(() => {
    let active = true
    void services.settings.getSettings()
      .then(value => {
        if (!active) return
        setSettings(value)
        setSavedSettings(value)
        setGlobalSettings(value)
        setSettingsDirty(false)
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? localizeError(cause.message, 'ru') : 'Не удалось загрузить настройки.')
      })

    void window.launcher?.system.getMemory()
      .then(value => { if (active) setMemory(value) })
      .catch(() => undefined)

    return () => { active = false }
  }, [setGlobalSettings, setSettingsDirty])

  useEffect(() => {
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      if (!settingsDirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeClose)
    return () => window.removeEventListener('beforeunload', warnBeforeClose)
  }, [settingsDirty])

  const update = (patch: Partial<LauncherSettings>) => {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    setGlobalSettings(next)
    setSettingsDirty(!sameSettings(next, savedSettings))
    setSaved(false)
    setMessage('')
    setError('')
  }

  const save = async () => {
    if (!settings || !settingsDirty) return
    setError('')
    try {
      const next = await services.settings.updateSettings(settings)
      setSettings(next)
      setSavedSettings(next)
      setGlobalSettings(next)
      setSettingsDirty(false)
      setSaved(true)
      setMessage(t.savedOnDevice)
    } catch (cause) {
      setError(cause instanceof Error ? localizeError(cause.message, t.locale) : t.settingsSaveFailed)
    }
  }

  const discard = () => {
    if (!savedSettings) return
    setSettings(savedSettings)
    setGlobalSettings(savedSettings)
    setSettingsDirty(false)
    setSaved(false)
    setMessage(t.changesDiscarded)
    setError('')
  }

  const reset = async () => {
    try {
      await services.settings.resetSettings()
      await services.settings.updateSettings({ setupComplete: true })
      const next = await services.settings.getSettings()
      setSettings(next)
      setSavedSettings(next)
      setGlobalSettings(next)
      setSettingsDirty(false)
      setSaved(true)
      setMessage(t.defaultsRestored)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? localizeError(cause.message, t.locale) : t.settingsResetFailed)
    }
  }

  const selectPath = async (target: 'javaPath' | 'gamePath') => {
    const kind = target === 'javaPath' ? 'file' : 'directory'
    if (!window.launcher) {
      setError(t.desktopOnlyDialog)
      return
    }
    try {
      const selected = await window.launcher.dialog.selectPath(kind)
      if (selected.path) update({ [target]: selected.path })
    } catch (cause) {
      setError(cause instanceof Error ? localizeError(cause.message, t.locale) : t.pathDialogFailed)
    }
  }

  const detectResolution = async () => {
    try {
      const res = await window.launcher?.system.getScreenResolution()
      if (res && res.width && res.height) {
        update({ width: res.width, height: res.height })
        setMessage(`Разрешение экрана определено: ${res.width}×${res.height}`)
      }
    } catch {
      setError('Не удалось определить разрешение экрана.')
    }
  }

  const jumpToSection = (id: string) => {
    setActiveSection(id)
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start'
    })
  }

  if (!settings) return <div className="loading-state">{error || t.loadingSettings}</div>

  const maxRam = Math.max(16, Math.min(memory?.totalGb ? memory.totalGb - 2 : 16, 64))

  // Генерация делений шкалы памяти
  const ramTicks: number[] = []
  const ramStep = maxRam <= 16 ? 2 : 4
  for (let r = 2; r <= maxRam; r += ramStep) {
    ramTicks.push(r)
  }
  if (!ramTicks.includes(maxRam)) {
    ramTicks.push(maxRam)
  }
  const ramPercent = Math.max(0, Math.min(100, ((settings.ramGb - 2) / (maxRam - 2)) * 100))

  const themeLabels = [
    [t.themeHeart, t.themeHeartDescription],
    [t.themeObsidian, t.themeObsidianDescription],
    [t.themeCrimson, t.themeCrimsonDescription],
    [t.themeOcean, t.themeOceanDescription],
    [t.themeAmethyst, t.themeAmethystDescription]
  ]

  return (
    <div className="settings-page">
      <SectionHeading
        title={t.settingsTitle}
        description={t.settingsDescription}
        action={
          <button className="primary-button save-button" onClick={() => void save()} disabled={!settingsDirty}>
            {saved ? <Check size={15} /> : <Save size={15} />}{saved ? t.saved : t.save}
          </button>
        }
      />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t.advanced}>
          {[
            { id: 'performance', label: t.performance, icon: Cpu },
            { id: 'game', label: t.gameSettings, icon: Monitor },
            { id: 'interface', label: t.interface, icon: Palette },
            { id: 'advanced', label: t.advanced, icon: SlidersHorizontal }
          ].map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={activeSection === id ? 'selected' : ''} onClick={() => jumpToSection(id)}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          <section className="settings-section" id="performance">
            <div className="settings-title">
              <Cpu size={17} />
              <div>
                <h3>{t.performance}</h3>
                <p>{t.performanceDescription}</p>
              </div>
            </div>

            <div className="setting-control">
              <div className="setting-label">
                <label htmlFor="ram-range">{t.ram}</label>
                <strong>{settings.ramGb} GB</strong>
              </div>

              {/* Блок слайдера с наглядной шкалой */}
              <div className="ram-slider-wrapper">
                <input
                  id="ram-range"
                  className="range-input"
                  type="range"
                  min="2"
                  max={maxRam}
                  step="1"
                  value={settings.ramGb}
                  style={{ '--range-pct': `${ramPercent}%` } as React.CSSProperties}
                  onChange={event => update({ ramGb: Number(event.target.value) })}
                />

                {/* Шкала с делениями */}
                <div className="ram-scale-ruler">
                  {ramTicks.map(val => {
                    const ratio = (val - 2) / (maxRam - 2)
                    const isCurrent = settings.ramGb === val
                    return (
                      <div
                        key={val}
                        className={`ram-scale-step ${isCurrent ? 'active' : ''}`}
                        style={{ left: `calc(7px + (100% - 14px) * ${ratio})` }}
                        onClick={() => update({ ramGb: val })}
                        title={`Выбрать ${val} GB`}
                      >
                        <i className="ram-scale-notch" />
                        <span className="ram-scale-text">{val}G</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              <p className="setting-help" style={{ marginTop: '16px' }}>
                {memory
                  ? t.systemMemory.replace('{total}', String(memory.totalGb)).replace('{free}', String(memory.freeGb))
                  : t.memoryUnavailable}
              </p>
            </div>
          </section>

          <section className="settings-section" id="game">
            <div className="settings-title"><Monitor size={17} /><div><h3>{t.gameSettings}</h3><p>{t.gameSettingsDescription}</p></div></div>
            <div className="setting-control">
              <label htmlFor="java-path">{t.javaPath}</label>
              <div className="path-input">
                <input id="java-path" value={settings.javaPath} onChange={event => update({ javaPath: event.target.value })} placeholder="Автопоиск Java 21 (или автоскачивание в .heart)" />
                <button type="button" aria-label={t.selectJava} onClick={() => void selectPath('javaPath')}><FolderOpen size={15}/></button>
              </div>
            </div>
            <div className="setting-control">
              <label htmlFor="game-path">{t.gamePath}</label>
              <div className="path-input">
                <input id="game-path" value={settings.gamePath} onChange={event => update({ gamePath: event.target.value })} placeholder="%APPDATA%/.heart (папка по умолчанию)" />
                <button type="button" aria-label={t.selectGameFolder} onClick={() => void selectPath('gamePath')}><FolderOpen size={15}/></button>
              </div>
            </div>
            <div className="setting-control">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ margin: 0 }}>{t.resolution}</label>
                <button
                  type="button"
                  className="outline-button"
                  style={{ height: '26px', fontSize: '11px', padding: '0 8px', gap: '4px' }}
                  onClick={() => void detectResolution()}
                >
                  <Monitor size={12} /> Авто (Экран)
                </button>
              </div>
              <div className="resolution-fields">
                <input aria-label={t.tr('Ширина', 'Width')} type="number" min="800" max="7680" value={settings.width} onChange={event => update({ width: Number(event.target.value) })}/>
                <span>×</span>
                <input aria-label={t.tr('Высота', 'Height')} type="number" min="600" max="4320" value={settings.height} onChange={event => update({ height: Number(event.target.value) })}/>
              </div>
            </div>
            <Toggle
              label="Окно без рамок (Borderless)"
              description="Запуск игры во весь экран без рамок (мгновенное переключение по Alt+Tab)"
              checked={settings.borderless ?? true}
              onChange={value => update({ borderless: value, fullscreen: false })}
            />
            <Toggle label={t.closeAfterLaunch} description={t.closeAfterLaunchDescription} checked={settings.closeOnLaunch} onChange={value => update({ closeOnLaunch: value })}/>
            <Toggle
              label="Подключаться сразу к серверу Heart"
              description="Заходить прямо на сервер без главного меню игры"
              checked={settings.autoConnectServer ?? false}
              onChange={value => update({ autoConnectServer: value })}
            />
          </section>

          <section className="settings-section" id="interface">
            <div className="settings-title"><Palette size={17} /><div><h3>{t.interface}</h3><p>{t.interfaceDescription}</p></div></div>
            
            {/* Блок выбора языка с аккуратным отступом и положением справа */}
            <div className="setting-control setting-row-flex">
              <div>
                <label htmlFor="app-language" style={{ display: 'block', fontSize: '13px', color: 'var(--text)', marginBottom: '2px' }}>
                  {t.language}
                </label>
                <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                  {t.tr('Язык отображения интерфейса', 'Interface display language')}
                </span>
              </div>
              <select
                id="app-language"
                className="theme-select"
                style={{ width: '160px', height: '36px', flexShrink: 0 }}
                value={settings.language}
                onChange={event => update({ language: event.target.value as 'ru' | 'en' })}
              >
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </div>

            <div className="setting-control theme-setting-control">
              <label>{t.theme}</label>
              <div className="settings-theme-grid">
                {THEMES.map((item, index) => (
                  <button key={item.id} type="button" className={`settings-theme-choice ${settings.theme === item.id ? 'selected' : ''}`} onClick={() => update({ theme: item.id })} aria-pressed={settings.theme === item.id}>
                    <span className="settings-theme-dot" style={{ background: item.color, boxShadow: `0 0 0 4px ${item.deep}` }} />
                    <span><b>{themeLabels[index][0]}</b><small>{themeLabels[index][1]}</small></span>
                    {settings.theme === item.id && <Check size={15} />}
                  </button>
                ))}
              </div>
            </div>
            <Toggle label={t.animations} description={t.animationsDescription} checked={settings.animations} onChange={value => update({ animations: value })}/>
          </section>

          <section className="settings-section" id="advanced">
            <div className="settings-title"><SlidersHorizontal size={17} /><div><h3>{t.advanced}</h3><p>{t.advancedDescription}</p></div></div>
            <div className="advanced-actions">
              <button className="outline-button" type="button" onClick={() => void window.launcher?.system.openGameFolder()}><FolderOpen size={14}/> {t.openGameFolder}</button>
            </div>
            <button className="text-button reset-button" type="button" onClick={() => void reset()}><RotateCcw size={13}/> {t.resetDefaults}</button>
          </section>
        </div>
      </div>

      {settingsDirty && (
        <div className="settings-save-dock" role="status" aria-live="polite">
          <div className="settings-save-copy"><span className="settings-save-dot" /><div><strong>{t.unsaved}</strong><small>{t.unsavedHint}</small></div></div>
          <div className="settings-save-actions">
            <button type="button" className="settings-discard-button" onClick={discard}><X size={14}/> {t.discard}</button>
            <button type="button" className="settings-save-button" onClick={() => void save()}><Save size={14}/> {t.save}</button>
          </div>
        </div>
      )}
      {(message || error) && (
        <div className={`settings-feedback ${error ? 'is-error' : ''}`} role="status">
          {error ? <AlertCircle size={15}/> : <Check size={15}/>} {error || message}
        </div>
      )}
    </div>
  )
}

function Toggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="toggle-row">
      <div><b>{label}</b><p>{description}</p></div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span/></button>
    </div>
  )
}