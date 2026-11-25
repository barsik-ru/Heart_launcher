import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail, Plus, Trash2, UserRound, X } from 'lucide-react'
import { loginSchema, registerSchema } from '@shared/schemas'
import type { UserProfile } from '@shared/types'
import { services } from '../services/container'
import { useAppStore } from '../stores/app-store'
import { MockBadge } from '../components/MockBadge'
import { TitleBar } from '../components/TitleBar'
import { HeartMark } from '../components/HeartMark'
import { brand } from '@shared/config/brand'
import { media } from '@shared/config/media'
import { assetUrl } from '../assets/asset-url'
import { useTranslation } from '../i18n/use-translation'
import { localizeError } from '../i18n/localize-content'
import { SkinViewer } from '../components/SkinViewer'

export function AuthPage({ mode = 'login' }: { mode?: 'login' | 'register' }) {
  const t = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedAccounts, setSavedAccounts] = useState<UserProfile[]>([])
  const [showNewForm, setShowNewForm] = useState(false)
  const passwordInputRef = useRef<HTMLInputElement | null>(null)
  const setProfile = useAppStore(state => state.setProfile)
  const navigate = useNavigate()
  const register = mode === 'register'

  useEffect(() => {
    setError('')
    setPassword('')
    setConfirmPassword('')
  }, [mode])

  useEffect(() => {
    const loadAccounts = async () => {
      try {
        const accs = services.auth.getSavedAccounts
          ? await services.auth.getSavedAccounts()
          : await window.launcher?.services.auth?.getSavedAccounts?.()

        if (accs && accs.length > 0) {
          setSavedAccounts(accs)
          setShowNewForm(false)
        } else {
          setShowNewForm(true)
        }
      } catch {
        setShowNewForm(true)
      }
    }
    void loadAccounts()
  }, [])

  const hasMinLength = password.length >= 8
  const hasUpperCase = /[A-Z]/.test(password)
  const hasNumber = /[0-9]/.test(password)
  const hasSpecialOrLong = /[^A-Za-z0-9]/.test(password) || password.length >= 10
  const passwordsMatch = register ? password.length > 0 && password === confirmPassword : true

  let strengthScore = 0
  if (hasMinLength) strengthScore++
  if (hasUpperCase) strengthScore++
  if (hasNumber) strengthScore++
  if (hasSpecialOrLong) strengthScore++

  const strengthColor =
    strengthScore <= 1 ? '#d18a7d' : strengthScore === 2 ? '#d0b17b' : strengthScore === 3 ? '#9aba7d' : '#82b96f'
  const strengthText =
    strengthScore <= 1 ? 'Слабый' : strengthScore === 2 ? 'Средний' : strengthScore === 3 ? 'Хороший' : 'Отличный'

  const selectSavedAccount = (account: UserProfile) => {
    setError('')
    setUsername(account.username)
    setPassword('')
    setShowNewForm(true)
    window.setTimeout(() => passwordInputRef.current?.focus(), 0)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')

    const cleanUsername = username.trim()

    if (register) {
      const validation = registerSchema.safeParse({
        username: cleanUsername,
        password,
        confirmPassword,
        email: email.trim(),
        accepted
      })
      if (!validation.success) {
        setError(localizeError(validation.error.issues[0]?.message ?? t.checkInput, t.locale))
        return
      }
    } else {
      const validation = loginSchema.safeParse({
        username: cleanUsername,
        password,
        remember
      })
      if (!validation.success) {
        setError(localizeError(validation.error.issues[0]?.message ?? t.checkInput, t.locale))
        return
      }
    }

    setBusy(true)
    try {
      const result = register
        ? await services.auth.register({
            username: cleanUsername,
            password,
            email: email.trim(),
            accepted: true
          })
        : await services.auth.login({
            username: cleanUsername,
            password,
            remember
          })

      if (result.success) {
        setProfile(result.profile)
        navigate('/', { replace: true })
      } else {
        setError(localizeError(result.message, t.locale))
      }
    } catch (cause) {
      setError(cause instanceof Error ? localizeError(cause.message, t.locale) : t.requestFailed)
    } finally {
      setBusy(false)
    }
  }

  const removeAccount = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      if (services.auth.removeSavedAccount) {
        await services.auth.removeSavedAccount(id)
      } else if (window.launcher?.services.auth?.removeSavedAccount) {
        await window.launcher.services.auth.removeSavedAccount(id)
      }
      setSavedAccounts(prev => {
        const next = prev.filter(a => a.id !== id)
        if (next.length === 0) setShowNewForm(true)
        return next
      })
    } catch {}
  }

  const matchedPreviewSkin =
    savedAccounts.find(a => a.username.toLowerCase() === username.trim().toLowerCase())?.skinUrl ?? null

  return (
    <div className="auth-window" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TitleBar />
      <main
        className="auth-screen"
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.15fr) minmax(430px, 0.85fr)',
          overflow: 'hidden',
          height: 'calc(100vh - 42px)'
        }}
      >
        <section
          className="auth-art"
          aria-label={t.authWorld}
          style={{ position: 'relative', height: '100%', overflow: 'hidden' }}
        >
          <div
            className="auth-art-image"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              backgroundImage: `url("${assetUrl(media.forest)}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          />
          <div className="auth-art-overlay" style={{ position: 'absolute', inset: 0 }} />
          <div className="auth-brand" style={{ position: 'relative', zIndex: 2 }}>
            <span className="brand-mark large"><HeartMark /></span>
            <span><strong>{brand.name}</strong></span>
          </div>
          <div className="auth-art-copy" style={{ position: 'absolute', left: '10%', bottom: '15%', zIndex: 2 }}>
            <h1>HEART<br/><em>Minecraft Java</em></h1>
            <p>{t.authCommunity}</p>
          </div>
        </section>

        <section
          className="auth-panel"
          style={{
            height: '100%',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxSizing: 'border-box'
          }}
        >
          <div className="auth-panel-top"><MockBadge /></div>

          <div className="auth-form-wrap" style={{ margin: 'auto', width: '100%', maxWidth: '400px', padding: '24px 0' }}>
            <h2>{register ? t.register : t.welcomeBack}</h2>
            <p className="auth-subtitle">
              {register
                ? t.authCreateSubtitle
                : t.tr('Выбери сохранённый профиль или введи логин и пароль', 'Select a saved profile or enter your login and password')}
            </p>

            {error && <div className="form-error" role="alert" style={{ marginBottom: '14px' }}>{error}</div>}

            {!register && savedAccounts.length > 0 && !showNewForm && (
              <div className="saved-accounts-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '18px' }}>
                <span style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 600 }}>
                  {t.tr('СОХРАНЁННЫЕ ПРОФИЛИ', 'SAVED PROFILES')}
                </span>
                {savedAccounts.map(acc => (
                  <div
                    key={acc.id}
                    onClick={() => selectSavedAccount(acc)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 14px',
                      borderRadius: '0px',
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = 'var(--accent)'
                      e.currentTarget.style.background = 'var(--surface)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--border)'
                      e.currentTarget.style.background = 'var(--surface-raised)'
                    }}
                  >
                    <div style={{ width: '36px', height: '36px', overflow: 'hidden', background: '#19221c', flexShrink: 0, border: '1px solid var(--border)' }}>
                      <SkinViewer skinUrl={acc.skinUrl} mode="head" width={36} height={36} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ display: 'block', fontSize: '14px', color: 'var(--text)' }}>{acc.username}</strong>
                      <small style={{ fontSize: '11px', color: 'var(--muted)' }}>
                        {t.tr('Нажмите, чтобы ввести пароль', 'Click to enter password')}
                      </small>
                    </div>

                    <button
                      type="button"
                      onClick={e => void removeAccount(acc.id, e)}
                      style={{ background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer', padding: '6px' }}
                      title={t.tr('Удалить профиль', 'Remove profile')}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--danger)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
                    >
                      <Trash2 size={16} />
                    </button>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={e => {
                        e.stopPropagation()
                        selectSavedAccount(acc)
                      }}
                      style={{ height: '32px', padding: '0 12px', fontSize: '11px', gap: '6px' }}
                      disabled={busy}
                    >
                      {t.login} <ArrowRight size={13} />
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  className="outline-button"
                  onClick={() => {
                    setError('')
                    setUsername('')
                    setPassword('')
                    setShowNewForm(true)
                  }}
                  style={{ width: '100%', marginTop: '6px', height: '38px' }}
                >
                  <Plus size={15} /> {t.tr('Войти под другим аккаунтом', 'Use another account')}
                </button>
              </div>
            )}

            {(showNewForm || register || savedAccounts.length === 0) && (
              <form onSubmit={submit} className="auth-form" noValidate>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '8px' }}>
                  <div style={{
                    width: '46px',
                    height: '46px',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-raised)',
                    display: 'grid',
                    placeItems: 'center',
                    overflow: 'hidden'
                  }}>
                    <SkinViewer skinUrl={matchedPreviewSkin} mode="head" width={46} height={46} />
                  </div>
                  <div>
                    <strong style={{ fontSize: '13px', display: 'block' }}>
                      {username.trim() || t.tr('Игрок', 'Player')}
                    </strong>
                    <span style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      {register ? t.tr('Регистрация Heart', 'Heart Registration') : t.tr('Авторизация Heart', 'Heart Sign In')}
                    </span>
                  </div>
                </div>

                <label htmlFor="auth-username">{t.username}</label>
                <div className="auth-input-wrap">
                  <UserRound size={16} />
                  <input
                    id="auth-username"
                    autoComplete="username"
                    value={username}
                    onChange={event => setUsername(event.target.value)}
                    minLength={3}
                    maxLength={16}
                    required
                    placeholder={t.tr('Твой ник (латиница, цифры, _)', 'Your username (A-Z, 0-9, _)')}
                    aria-invalid={Boolean(error)}
                  />
                </div>

                {register && (
                  <>
                    <label htmlFor="auth-email">{t.email}</label>
                    <div className="auth-input-wrap">
                      <Mail size={16} />
                      <input
                        id="auth-email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={event => setEmail(event.target.value)}
                        required
                        placeholder="name@example.com"
                      />
                    </div>
                  </>
                )}

                <label htmlFor="auth-password">{t.password}</label>
                <div className="auth-input-wrap">
                  <LockKeyhole size={16} />
                  <input
                    ref={passwordInputRef}
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={register ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    required
                    placeholder={register ? t.passwordPlaceholder : t.tr('Введи свой пароль', 'Enter your password')}
                  />
                  <button
                    type="button"
                    className="password-visibility"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? t.hidePassword : t.showPassword}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                {register && password.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '2px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--muted)' }}>
                      <span>Сложность пароля:</span>
                      <strong style={{ color: strengthColor }}>{strengthText}</strong>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px', height: '4px' }}>
                      {[1, 2, 3, 4].map(idx => (
                        <div
                          key={idx}
                          style={{
                            height: '100%',
                            borderRadius: '2px',
                            background: idx <= strengthScore ? strengthColor : 'var(--panel-2)',
                            transition: 'all 0.2s ease'
                          }}
                        />
                      ))}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', marginTop: '4px', fontSize: '11px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: hasMinLength ? '#9aba7d' : 'var(--muted)' }}>
                        {hasMinLength ? <Check size={12} /> : <X size={12} />} 8+ символов
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: hasUpperCase ? '#9aba7d' : 'var(--muted)' }}>
                        {hasUpperCase ? <Check size={12} /> : <X size={12} />} Заглавная буква (A-Z)
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: hasNumber ? '#9aba7d' : 'var(--muted)' }}>
                        {hasNumber ? <Check size={12} /> : <X size={12} />} Хотя бы 1 цифра
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: hasSpecialOrLong ? '#9aba7d' : 'var(--muted)' }}>
                        {hasSpecialOrLong ? <Check size={12} /> : <X size={12} />} 10+ знаков / спецсимвол
                      </span>
                      {confirmPassword.length > 0 && (
                        <span style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '5px', color: passwordsMatch ? '#9aba7d' : 'var(--danger)' }}>
                          {passwordsMatch ? <Check size={12} /> : <X size={12} />} Пароли совпадают
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {register && (
                  <>
                    <label htmlFor="auth-confirm">{t.confirmPassword}</label>
                    <div className="auth-input-wrap">
                      <LockKeyhole size={16} />
                      <input
                        id="auth-confirm"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={event => setConfirmPassword(event.target.value)}
                        required
                        placeholder={t.confirmPassword}
                      />
                    </div>
                    <label className="check-line auth-consent">
                      <input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />
                      {t.communityRules}
                    </label>
                  </>
                )}

                {!register && (
                  <div className="auth-options">
                    <label className="check-line">
                      <input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />
                      {t.rememberMe}
                    </label>
                  </div>
                )}

                {!register && savedAccounts.length > 0 && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setError('')
                      setPassword('')
                      setShowNewForm(false)
                    }}
                    style={{ alignSelf: 'flex-start', fontSize: '12px' }}
                  >
                    ← {t.tr('Назад к сохранённым профилям', 'Back to saved profiles')}
                  </button>
                )}

                <button className="primary-button auth-submit" type="submit" disabled={busy}>
                  {busy ? t.checkingData : register ? t.register : t.login}
                  <ArrowRight size={16} />
                </button>
              </form>
            )}

            <div className="auth-switch">
              {register ? t.alreadyAccount : t.firstTime}{' '}
              <Link to={register ? '/login' : '/register'}>{register ? t.login : t.register}</Link>
            </div>
          </div>

          <div className="auth-legal" style={{ padding: '16px 0' }}>{t.communityAccountNote}</div>
        </section>
      </main>
    </div>
  )
}