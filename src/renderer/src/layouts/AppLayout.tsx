import { motion, useReducedMotion } from 'framer-motion'
import { useLocation, useOutlet } from 'react-router-dom'
import { TitleBar } from '../components/TitleBar'
import { Sidebar } from '../components/Sidebar'
import { useAppStore } from '../stores/app-store'

export function AppLayout() {
  const settings = useAppStore(state => state.settings)
  const animations = settings?.animations ?? true
  const reducedMotion = useReducedMotion()
  const location = useLocation()
  const outlet = useOutlet()
  const motionEnabled = animations && !reducedMotion

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="app-body">
        <Sidebar />
        <main className="main-content" style={{ paddingTop: '28px' }}>
          <motion.div
            key={location.pathname}
            className="page-content route-page"
            initial={motionEnabled ? { opacity: 0, y: 9 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={motionEnabled
              ? { duration: 0.24, ease: [0.22, 1, 0.36, 1] }
              : { duration: 0 }}
          >
            {outlet}
          </motion.div>
        </main>
      </div>
    </div>
  )
}