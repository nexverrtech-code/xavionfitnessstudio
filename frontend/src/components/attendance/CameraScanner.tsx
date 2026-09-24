import { Camera, CameraOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'

interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}
declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike
  }
}

type Decoder = (video: HTMLVideoElement) => Promise<string | null>

async function createDecoder(): Promise<Decoder> {
  if (window.BarcodeDetector) {
    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
      return async (video) => (await detector.detect(video))[0]?.rawValue ?? null
    } catch {
      /* fall through to jsQR */
    }
  }
  // Loaded only on browsers without a native detector (e.g. desktop Firefox / Safari).
  const { default: jsQR } = await import('jsqr')
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  return async (video) => {
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, 1))
    canvas.width = Math.max(1, Math.floor(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.floor(video.videoHeight * scale))
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    return jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null
  }
}

/** Camera QR scanner. Calls onCode for every new code; the same code is ignored for `cooldownMs`. */
export function CameraScanner({ onCode, cooldownMs = 4000 }: { onCode: (code: string) => void; cooldownMs?: number }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const lastRef = useRef<{ code: string; at: number } | null>(null)
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode
  const [state, setState] = useState<'idle' | 'starting' | 'running' | 'denied' | 'unavailable'>('idle')

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setState('idle')
  }, [])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable')
      return
    }
    setState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setState('running')
    } catch (error) {
      setState((error as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable')
    }
  }, [])

  useEffect(() => {
    if (state !== 'running') return
    let cancelled = false
    let timer = 0
    let decode: Decoder | null = null
    const tick = async () => {
      if (cancelled) return
      const video = videoRef.current
      try {
        decode ??= await createDecoder()
        if (video && video.readyState >= 2) {
          const code = await decode(video)
          const now = Date.now()
          if (code && !(lastRef.current && lastRef.current.code === code && now - lastRef.current.at < cooldownMs)) {
            lastRef.current = { code, at: now }
            onCodeRef.current(code)
          }
        }
      } catch {
        /* keep scanning */
      }
      timer = window.setTimeout(tick, 220)
    }
    tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [state, cooldownMs])

  useEffect(() => stop, [stop])

  return (
    <div className="relative overflow-hidden rounded-2xl bg-neutral-950">
      <video ref={videoRef} muted playsInline className={cn('aspect-[4/3] w-full object-cover', state !== 'running' && 'invisible')} aria-label="Camera preview" />
      {state === 'running' ? (
        <>
          <div className="pointer-events-none absolute inset-[14%] rounded-3xl border-2 border-white/80 shadow-[0_0_0_9999px_rgb(2_6_23/0.45)]" aria-hidden>
            <span className="absolute inset-x-4 h-0.5 animate-scan rounded-full bg-volt shadow-[0_0_12px_2px_rgb(198_244_50/0.7)]" />
          </div>
          <button type="button" onClick={stop} className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-xl bg-neutral-900/70 px-3 py-2 text-[13px] font-semibold text-white backdrop-blur hover:bg-neutral-900">
            <CameraOff className="size-4" aria-hidden /> Stop
          </button>
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
            <Camera className="size-6 text-volt" aria-hidden />
          </span>
          <p className="max-w-xs text-sm text-white/80">
            {state === 'denied'
              ? 'Camera permission was blocked. Allow camera access in your browser settings, or use the scanner field below.'
              : state === 'unavailable'
                ? 'No camera is available on this device. Use a USB QR scanner or type the member ID below.'
                : 'Point the camera at the member’s QR code. Codes scan automatically.'}
          </p>
          {(state === 'idle' || state === 'starting') && (
            <Button onClick={start} loading={state === 'starting'} icon={Camera}>
              Start camera
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
