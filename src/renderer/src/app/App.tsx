import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AppLayout } from '../layouts/AppLayout'
import { AuthPage } from '../pages/AuthPage'
import { HomePage } from '../pages/HomePage'
import { NewsPage } from '../pages/NewsPage'
import { ModpackPage } from '../pages/ModpackPage'
import { ProfilePage } from '../pages/ProfilePage'
import { SettingsPage } from '../pages/SettingsPage'
import { InstallationPage } from '../pages/InstallationPage'
import { useAppStore } from '../stores/app-store'
import { services } from '../services/container'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { AppearanceSetup } from '../components/AppearanceSetup'

function Protected({ children }: { children: ReactNode }) {
  const profile = useAppStore(state => state.profile)
  return profile ? children : <Navigate to="/login" replace/>
}

export function App() {
  const profile = useAppStore(state => state.profile)
  const settings = useAppStore(state => state.settings)
  const animations = settings?.animations ?? true
  const setProfile = useAppStore(state => state.setProfile)
  const setSettings = useAppStore(state => state.setSettings)
  const setLauncher = useAppStore(state => state.setLauncher)

  useEffect(() => {
    let active = true
    void services.auth.getProfile().then(value => { if (active && value) setProfile(value) }).catch(() => undefined)
    void services.settings.getSettings().then(value => { if (active) setSettings(value) }).catch(() => undefined)
    void services.launcher.getStatus().then(value => { if (active) setLauncher(value) }).catch(() => undefined)
    const unsubscribe = services.launcher.onStateChange(setLauncher)
    return () => { active = false; unsubscribe() }
  }, [setProfile, setSettings, setLauncher])

  return (
    <ErrorBoundary>
      <div
        className={`app-root ${animations ? 'motion-on' : 'motion-off'}`}
        data-theme={settings?.theme ?? 'verdant'}
        lang={settings?.language ?? 'ru'}
      >
        <HashRouter>
          <Routes>
            <Route path="/login" element={profile ? <Navigate to="/" replace/> : <AuthPage/>}/>
            <Route path="/register" element={profile ? <Navigate to="/" replace/> : <AuthPage mode="register"/>}/>
            <Route element={<Protected><AppLayout/></Protected>}>
              <Route path="/" element={<HomePage/>}/>
              <Route path="/news" element={<NewsPage/>}/>
              <Route path="/news/:id" element={<NewsPage/>}/>
              <Route path="/modpack" element={<ModpackPage/>}/>
              <Route path="/installation" element={<InstallationPage/>}/>
              <Route path="/profile" element={<ProfilePage/>}/>
              <Route path="/settings" element={<SettingsPage/>}/>
            </Route>
            <Route path="*" element={<Navigate to={profile ? '/' : '/login'} replace/>}/>
          </Routes>
        </HashRouter>
        {settings && !settings.setupComplete && <AppearanceSetup settings={settings} onComplete={setSettings}/>}
      </div>
    </ErrorBoundary>
  )
}