import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { HeartMark } from './HeartMark'

type StartupRevealProps = { enabled: boolean }

/** Show the Heart intro once per application launch, never on route changes or setting toggles. */
export function StartupReveal({ enabled }: StartupRevealProps) {
  const [visible, setVisible] = useState(false)
  const shouldShowOnStartup = useRef(enabled)

  useEffect(() => {
    if (!shouldShowOnStartup.current) return

    setVisible(true)
    const timeout = window.setTimeout(() => setVisible(false), 2600)
    return () => window.clearTimeout(timeout)
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="startup-reveal"
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.48, ease: 'easeOut' } }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
        >
          <div className="startup-grain" />
          <div className="startup-center">
            <div className="startup-impact startup-heart-pulse" />
            <motion.div
              className="startup-heart-wrap"
              initial={{ y: 24, scale: 0.28, rotate: -24, opacity: 0 }}
              animate={{ y: 0, scale: [0.28, 1.16, 0.94, 1], rotate: [-24, 9, -4, 0], opacity: 1 }}
              transition={{ duration: 1.08, delay: 0.06, ease: [0.18, 0.76, 0.24, 1] }}
            >
              <HeartMark />
            </motion.div>
            <motion.div
              className="startup-wordmark"
              initial={{ opacity: 0, y: 12, letterSpacing: '0.36em' }}
              animate={{ opacity: 1, y: 0, letterSpacing: '0.2em' }}
              transition={{ duration: 0.5, delay: 0.78, ease: 'easeOut' }}
            >
              HEART
              <span>MINECRAFT LAUNCHER</span>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
