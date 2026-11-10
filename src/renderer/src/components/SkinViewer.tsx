import { useEffect, useRef } from 'react'

interface SkinViewerProps {
  skinUrl?: string | null
  capeUrl?: string | null
  mode?: 'head' | 'body'
  view?: 'front' | 'back'
  variant?: 'classic' | 'slim'
  width?: number
  height?: number
  className?: string
}

const DEFAULT_STEVE_URL = new URL('steve.png', document.baseURI).toString()

export function SkinViewer({
  skinUrl,
  capeUrl,
  mode = 'head',
  view = 'front',
  variant = 'classic',
  width = 64,
  height = 64,
  className
}: SkinViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let targetUrl = skinUrl && skinUrl.trim() ? skinUrl.trim() : DEFAULT_STEVE_URL
    if (targetUrl.startsWith('http://textures.minecraft.net')) {
      targetUrl = targetUrl.replace('http://', 'https://')
    }

    const isSlim = variant === 'slim'
    const skinImg = new Image()
    skinImg.crossOrigin = 'anonymous'

    skinImg.onerror = () => {
      drawSteveProcedural(ctx, canvas.width, canvas.height, mode, view, isSlim)
      drawCapeIfAvailable(ctx, capeUrl, canvas.width / 16, view)
    }

    skinImg.onload = () => {
      try {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.imageSmoothingEnabled = false

        const isOldFormat = skinImg.height === 32

        if (mode === 'head') {
          ctx.drawImage(skinImg, 8, 8, 8, 8, 0, 0, canvas.width, canvas.height)
          ctx.drawImage(skinImg, 40, 8, 8, 8, 0, 0, canvas.width, canvas.height)
          return
        }

        const scale = canvas.width / 16
        const armW = isSlim ? 3 : 4
        const rightArmX = isSlim ? 1 * scale : 0
        const leftArmX = 12 * scale

        if (view === 'front') {
          // Голова и шлем
          ctx.drawImage(skinImg, 8, 8, 8, 8, 4 * scale, 0, 8 * scale, 8 * scale)
          ctx.drawImage(skinImg, 40, 8, 8, 8, 4 * scale, 0, 8 * scale, 8 * scale)

          // Торс
          ctx.drawImage(skinImg, 20, 20, 8, 12, 4 * scale, 8 * scale, 8 * scale, 12 * scale)
          if (!isOldFormat) {
            ctx.drawImage(skinImg, 20, 36, 8, 12, 4 * scale, 8 * scale, 8 * scale, 12 * scale)
          }

          // Правая рука (слева от зрителя)
          ctx.drawImage(skinImg, 44, 20, armW, 12, rightArmX, 8 * scale, armW * scale, 12 * scale)
          if (!isOldFormat) {
            ctx.drawImage(skinImg, 44, 36, armW, 12, rightArmX, 8 * scale, armW * scale, 12 * scale)
          }

          // Левая рука (справа от зрителя)
          if (!isOldFormat) {
            ctx.drawImage(skinImg, 36, 52, armW, 12, leftArmX, 8 * scale, armW * scale, 12 * scale)
            ctx.drawImage(skinImg, 52, 52, armW, 12, leftArmX, 8 * scale, armW * scale, 12 * scale)
          } else {
            ctx.save()
            ctx.scale(-1, 1)
            ctx.drawImage(skinImg, 44, 20, armW, 12, -(leftArmX + armW * scale), 8 * scale, armW * scale, 12 * scale)
            ctx.restore()
          }

          // Ноги
          ctx.drawImage(skinImg, 4, 20, 4, 12, 4 * scale, 20 * scale, 4 * scale, 12 * scale)
          if (!isOldFormat) {
            ctx.drawImage(skinImg, 4, 36, 4, 12, 4 * scale, 20 * scale, 4 * scale, 12 * scale)
          }

          if (!isOldFormat) {
            ctx.drawImage(skinImg, 20, 52, 4, 12, 8 * scale, 20 * scale, 4 * scale, 12 * scale)
            ctx.drawImage(skinImg, 4, 52, 4, 12, 8 * scale, 20 * scale, 4 * scale, 12 * scale)
          } else {
            ctx.save()
            ctx.scale(-1, 1)
            ctx.drawImage(skinImg, 4, 20, 4, 12, -12 * scale, 20 * scale, 4 * scale, 12 * scale)
            ctx.restore()
          }
        } else {
          // Вид сзади
          ctx.drawImage(skinImg, 24, 8, 8, 8, 4 * scale, 0, 8 * scale, 8 * scale)
          ctx.drawImage(skinImg, 56, 8, 8, 8, 4 * scale, 0, 8 * scale, 8 * scale)

          ctx.drawImage(skinImg, 32, 20, 8, 12, 4 * scale, 8 * scale, 8 * scale, 12 * scale)
          if (!isOldFormat) {
            ctx.drawImage(skinImg, 32, 36, 8, 12, 4 * scale, 8 * scale, 8 * scale, 12 * scale)
          }

          const armBackSrcX = isSlim ? 51 : 52
          ctx.drawImage(skinImg, armBackSrcX, 20, armW, 12, leftArmX, 8 * scale, armW * scale, 12 * scale)
          if (!isOldFormat) {
            const leftArmBackSrcX = isSlim ? 43 : 44
            ctx.drawImage(skinImg, leftArmBackSrcX, 52, armW, 12, rightArmX, 8 * scale, armW * scale, 12 * scale)
          }

          ctx.drawImage(skinImg, 12, 20, 4, 12, 4 * scale, 20 * scale, 4 * scale, 12 * scale)
          if (!isOldFormat) {
            ctx.drawImage(skinImg, 28, 52, 4, 12, 8 * scale, 20 * scale, 4 * scale, 12 * scale)
          }

          drawCapeIfAvailable(ctx, capeUrl, scale, view)
        }
      } catch {
        drawSteveProcedural(ctx, canvas.width, canvas.height, mode, view, isSlim)
      }
    }

    skinImg.src = targetUrl
  }, [skinUrl, capeUrl, mode, view, variant, width, height])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ imageRendering: 'pixelated' }}
    />
  )
}

function drawCapeIfAvailable(
  ctx: CanvasRenderingContext2D,
  capeUrl: string | null | undefined,
  scale: number,
  view: 'front' | 'back'
) {
  if (view !== 'back' || !capeUrl) return
  const capeImg = new Image()
  capeImg.crossOrigin = 'anonymous'
  capeImg.onload = () => {
    try {
      const isHd = capeImg.width >= 128
      const srcX = isHd ? 2 : 1
      const srcY = isHd ? 2 : 1
      const srcW = isHd ? 20 : 10
      const srcH = isHd ? 32 : 16
      ctx.drawImage(capeImg, srcX, srcY, srcW, srcH, 3 * scale, 8 * scale, 10 * scale, 16 * scale)
    } catch {}
  }
  capeImg.src = capeUrl
}

function drawSteveProcedural(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: 'head' | 'body',
  view: 'front' | 'back',
  isSlim = false
) {
  ctx.clearRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = false
  const s = mode === 'head' ? width / 8 : width / 16
  const armW = isSlim ? 3 : 4
  const rightArmX = isSlim ? 1 : 0
  const leftArmX = 12

  if (mode === 'head') {
    ctx.fillStyle = '#452915'; ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#B67A52'; ctx.fillRect(1 * s, 2 * s, 6 * s, 5 * s)
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(1 * s, 4 * s, 2 * s, 1 * s); ctx.fillRect(5 * s, 4 * s, 2 * s, 1 * s)
    ctx.fillStyle = '#2C1B79'; ctx.fillRect(2 * s, 4 * s, 1 * s, 1 * s); ctx.fillRect(5 * s, 4 * s, 1 * s, 1 * s)
    ctx.fillStyle = '#9C603C'; ctx.fillRect(3 * s, 5 * s, 2 * s, 1 * s)
    ctx.fillStyle = '#532C1B'; ctx.fillRect(3 * s, 6 * s, 2 * s, 1 * s)
    return
  }

  ctx.fillStyle = '#452915'; ctx.fillRect(4 * s, 0, 8 * s, 8 * s)
  if (view === 'front') {
    ctx.fillStyle = '#B67A52'; ctx.fillRect(5 * s, 2 * s, 6 * s, 5 * s)
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(5 * s, 4 * s, 2 * s, 1 * s); ctx.fillRect(9 * s, 4 * s, 2 * s, 1 * s)
    ctx.fillStyle = '#2C1B79'; ctx.fillRect(6 * s, 4 * s, 1 * s, 1 * s); ctx.fillRect(9 * s, 4 * s, 1 * s, 1 * s)
  }
  ctx.fillStyle = '#00A6A6'; ctx.fillRect(4 * s, 8 * s, 8 * s, 12 * s)
  ctx.fillStyle = '#00A6A6'; ctx.fillRect(rightArmX * s, 8 * s, armW * s, 4 * s); ctx.fillRect(leftArmX * s, 8 * s, armW * s, 4 * s)
  ctx.fillStyle = '#B67A52'; ctx.fillRect(rightArmX * s, 12 * s, armW * s, 8 * s); ctx.fillRect(leftArmX * s, 12 * s, armW * s, 8 * s)
  ctx.fillStyle = '#273896'; ctx.fillRect(4 * s, 20 * s, 8 * s, 10 * s)
  ctx.fillStyle = '#454545'; ctx.fillRect(4 * s, 30 * s, 8 * s, 2 * s)
}