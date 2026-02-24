import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/70 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-40 select-none',
  {
    variants: {
      variant: {
        default:
          'bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md shadow-brand-900/40 hover:from-brand-400 hover:to-brand-600 active:scale-[0.98]',
        destructive:
          'bg-gradient-to-br from-red-500 to-red-700 text-white shadow-md shadow-red-900/40 hover:from-red-400 hover:to-red-600 active:scale-[0.98]',
        outline:
          'border border-white/12 bg-white/[0.04] text-gray-200 hover:bg-white/[0.08] hover:border-white/20 active:scale-[0.98]',
        secondary:
          'bg-white/[0.08] text-gray-200 hover:bg-white/[0.13] active:scale-[0.98]',
        ghost:
          'text-gray-400 hover:bg-white/[0.07] hover:text-white active:scale-[0.98]',
        link: 'text-brand-400 underline-offset-4 hover:underline hover:text-brand-300 p-0 h-auto rounded-none',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-7 rounded-lg px-3 text-xs',
        lg: 'h-11 rounded-xl px-6 text-base',
        icon: 'h-9 w-9',
        'icon-sm': 'h-7 w-7 rounded-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled ?? loading}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'

export { buttonVariants }
