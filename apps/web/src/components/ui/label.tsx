import * as RadixLabel from '@radix-ui/react-label'
import { cn } from '@/lib/utils'

export function Label({
  className,
  ...props
}: RadixLabel.LabelProps) {
  return (
    <RadixLabel.Root
      className={cn(
        'text-sm font-medium text-gray-300 leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  )
}
