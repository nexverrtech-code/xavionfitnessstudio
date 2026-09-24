import { useMemo } from 'react'
import { cn } from '@/utils/cn'
import { encodeQR, qrPath, type EccLevel } from '@/utils/qr'

interface QRCodeProps {
  value: string
  size?: number
  ecc?: EccLevel
  className?: string
  label: string
}

/** Rendered on the device from a short string — no QR image is ever stored. */
export function QRCode({ value, size = 240, ecc = 'M', className, label }: QRCodeProps) {
  const { path, dimension } = useMemo(() => {
    const code = encodeQR(value, ecc)
    return { path: qrPath(code, 3), dimension: code.size + 6 }
  }, [value, ecc])
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${dimension} ${dimension}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cn('rounded-2xl bg-white', className)}
    >
      <rect width={dimension} height={dimension} style={{ fill: 'var(--color-qr-light)' }} />
      <path d={path} style={{ fill: 'var(--color-qr-dark)' }} />
    </svg>
  )
}
