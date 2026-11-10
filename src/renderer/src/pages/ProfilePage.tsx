import { useState, useRef } from 'react'
import { useAppStore } from '../stores/app-store'
import { SectionHeading } from '../components/SectionHeading'
import { SkinViewer } from '../components/SkinViewer'
import { CalendarDays, ShieldCheck, Award, Upload, Trash2, RefreshCw } from 'lucide-react'
import { useTranslation } from '../i18n/use-translation'

export function ProfilePage() {
  const t = useTranslation()
  const profile = useAppStore(state => state.profile)
  const setProfile = useAppStore(state => state.setProfile)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [skinSyncBusy, setSkinSyncBusy] = useState(false)
  const [skinVariant, setSkinVariant] = useState<'classic' | 'slim'>(profile?.skinVariant ?? 'classic')
  const [viewAngle, setViewAngle] = useState<'front' | 'back'>('front')
  const skinInputRef = useRef<HTMLInputElement | null>(null)

  if (!profile) return null

  const locale = t.locale === 'en' ? 'en-US' : 'ru-RU'
  const registeredDate = new Date(profile.registeredAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  const statusLabel = profile.status === 'active' ? t.active : profile.status === 'pending' ? t.pending : t.blocked
  const group = profile.group === 'Путник' ? t.tr('Игрок', 'Player') : profile.group

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setError('')
    setSuccess('')
    if (!file.name.toLowerCase().endsWith('.png') || (file.type && file.type !== 'image/png')) {
      setError('Файл должен быть в формате PNG.')
      return
    }
    if (file.size > 1024 * 1024) {
      setError('Размер PNG не должен превышать 1 МБ.')
      return
    }

    const reader = new FileReader()
    reader.onerror = () => setError('Не удалось прочитать PNG-файл.')
    reader.onload = event => {
      const dataUrl = event.target?.result as string
      if (!dataUrl) return
      const img = new Image()
      img.onerror = () => setError('Не удалось прочитать изображение PNG.')
      img.onload = async () => {
        if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) {
          setError('Размер скина должен быть 64×64 или 64×32 пикселя.')
          return
        }

        setSkinSyncBusy(true)
        try {
          const auth = window.launcher?.services.auth
          if (!auth?.saveSkin) throw new Error('Загрузка скинов недоступна.')
          
          const updated = await auth.saveSkin(profile.username, dataUrl, 'skin', skinVariant)
          setProfile({
            ...profile,
            ...updated,
            skinUrl: updated?.skinUrl || dataUrl,
            skinVariant: updated?.skinVariant || skinVariant
          })
          setSuccess('Скин успешно установлен!')
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Не удалось загрузить скин.')
        } finally {
          setSkinSyncBusy(false)
        }
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  }

  const handleRemove = async () => {
    setError('')
    setSuccess('')
    try {
      const auth = window.launcher?.services.auth
      if (!auth?.removeSkin) throw new Error('Сброс скина недоступен.')
      const updated = await auth.removeSkin(profile.username, 'skin')
      setProfile({
        ...profile,
        ...updated,
        skinUrl: null
      })
      setSuccess('Скин сброшен к стандартному.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось сбросить скин.')
    }
  }

  return (
    <>
      <SectionHeading title={t.profileTitle} description={t.profileDescription} />

      <div className="profile-hero">
        <div className="profile-avatar" style={{ overflow: 'hidden', padding: 0 }}>
          <SkinViewer skinUrl={profile.skinUrl} mode="head" width={64} height={64} />
        </div>
        <div className="profile-identity">
          <h2>{profile.username}</h2>
          <span className="profile-id">{t.accountId} {profile.id}</span>
        </div>
        <div className="profile-status">{statusLabel}</div>
      </div>

      {error && <div className="home-error" style={{ marginBottom: '14px' }}>{error}</div>}
      {success && <div className="settings-feedback" style={{ marginBottom: '14px' }}>{success}</div>}

      <div className="profile-grid">
        <div className="profile-panel">
          <div className="panel-heading"><h3>{t.accountData}</h3></div>
          <div className="profile-data-row"><span><CalendarDays size={15}/> {t.registrationDate}</span><b>{registeredDate}</b></div>
          <div className="profile-data-row"><span><ShieldCheck size={15}/> {t.status}</span><b className={profile.status === 'active' ? 'online-text' : ''}>{statusLabel}</b></div>
          <div className="profile-data-row"><span><Award size={15}/> {t.group}</span><b>{group}</b></div>
          <div className="profile-data-row"><span>{t.email}</span><b>{profile.email}</b></div>
        </div>

        {/* Гардероб */}
        <div className="profile-panel">
          <div className="panel-heading">
            <h3>Скин персонажа</h3>
            <button
              type="button"
              className="outline-button"
              onClick={() => setViewAngle(v => (v === 'front' ? 'back' : 'front'))}
              style={{ fontSize: '11px', height: '28px', padding: '0 8px', gap: '6px' }}
              title="Повернуть персонажа"
            >
              <RefreshCw size={12} /> {viewAngle === 'front' ? 'Вид со спины' : 'Вид спереди'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', padding: '12px 0' }}>
            <div style={{
              width: '90px',
              height: '180px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0
            }}>
              <SkinViewer
                skinUrl={profile.skinUrl}
                capeUrl={profile.capeUrl}
                mode="body"
                view={viewAngle}
                variant={skinVariant}
                width={80}
                height={160}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
              <input
                ref={skinInputRef}
                type="file"
                accept="image/png,.png"
                style={{ display: 'none' }}
                onChange={handleFileUpload}
              />

              <button
                type="button"
                className="primary-button"
                disabled={skinSyncBusy}
                onClick={() => skinInputRef.current?.click()}
                style={{ width: '100%', fontSize: '13px' }}
              >
                <Upload size={14} /> {skinSyncBusy ? 'Установка…' : 'Загрузить скин (.png)'}
              </button>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', color: 'var(--muted)' }}>
                Модель рук
                <select
                  value={skinVariant}
                  onChange={e => setSkinVariant(e.target.value as 'classic' | 'slim')}
                  style={{ width: '100%', minHeight: '36px', padding: '0 10px', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--border)' }}
                >
                  <option value="classic">Classic — 4px (Steve)</option>
                  <option value="slim">Slim — 3px (Alex)</option>
                </select>
              </label>

              {profile.skinUrl && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void handleRemove()}
                  style={{ color: 'var(--danger)', fontSize: '12px', alignSelf: 'flex-start' }}
                >
                  <Trash2 size={13} /> Сбросить скин
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}