import { type HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-brand-600/20 text-brand-300 border border-brand-500/30',
        secondary: 'bg-white/10 text-gray-300 border border-white/15',
        destructive: 'bg-red-600/20 text-red-300 border border-red-500/30',
        success: 'bg-green-600/20 text-green-300 border border-green-500/30',
        warning: 'bg-amber-600/20 text-amber-300 border border-amber-500/30',
        info: 'bg-blue-600/20 text-blue-300 border border-blue-500/30',
        outline: 'border border-white/20 text-gray-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
