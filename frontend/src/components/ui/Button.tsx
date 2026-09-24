import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'
import { cn } from '@/utils/cn'
import { Spinner } from './Feedback'

type Variant = 'primary' | 'secondary' | 'ghost' | 'soft' | 'danger' | 'success' | 'dark'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary text-on-primary shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(0_0_0/0.2)] hover:bg-primary-hover active:bg-primary-active',
  secondary: 'border border-line bg-surface text-ink shadow-card hover:border-line-strong hover:bg-hover',
  ghost: 'text-ink-2 hover:bg-hover hover:text-ink',
  soft: 'bg-accent-50 text-accent-800 hover:bg-accent-100 dark:bg-accent-500/15 dark:text-accent-200 dark:hover:bg-accent-500/25',
  danger: 'bg-danger-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15)] hover:bg-danger-700',
  success: 'bg-success-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15)] hover:bg-success-700',
  dark: 'bg-ink text-canvas hover:opacity-90',
}

const SIZES: Record<Size, string> = {
  sm: 'h-9 gap-1.5 px-3 text-[13px]',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2 px-5 text-[15px]',
  icon: 'size-10',
  'icon-sm': 'size-8',
}

export function buttonClasses(variant: Variant = 'primary', size: Size = 'md', className?: string): string {
  return cn(
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-xl font-semibold',
    'transition-[background-color,border-color,color,transform,opacity] duration-150 active:scale-[0.98]',
    'disabled:pointer-events-none disabled:opacity-55',
    VARIANTS[variant],
    SIZES[size],
    className,
  )
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: LucideIcon
  iconRight?: LucideIcon
  fullWidth?: boolean
  children?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  iconRight: IconRight,
  fullWidth,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  const iconSize = size === 'sm' || size === 'icon-sm' ? 'size-4' : 'size-[18px]'
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, cn(fullWidth && 'w-full', className))}
      {...props}
    >
      {loading ? <Spinner className={iconSize} /> : Icon ? <Icon className={iconSize} aria-hidden /> : null}
      {children}
      {IconRight && !loading && <IconRight className={iconSize} aria-hidden />}
    </button>
  )
}

interface ButtonLinkProps extends LinkProps {
  variant?: Variant
  size?: Size
  icon?: LucideIcon
}

export function ButtonLink({ variant = 'secondary', size = 'md', icon: Icon, className, children, ...props }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...props}>
      {Icon && <Icon className={size === 'sm' ? 'size-4' : 'size-[18px]'} aria-hidden />}
      {children}
    </Link>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon
  label: string
  variant?: Variant
  size?: 'icon' | 'icon-sm'
  badge?: number
}

export function IconButton({ icon: Icon, label, variant = 'ghost', size = 'icon', badge, className, type = 'button', ...props }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} title={label} className={buttonClasses(variant, size, cn('relative', className))} {...props}>
      <Icon className={size === 'icon-sm' ? 'size-4' : 'size-5'} aria-hidden />
      {!!badge && badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-surface">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}
