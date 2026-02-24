import * as RadixSelect from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Select = RadixSelect.Root
export const SelectGroup = RadixSelect.Group
export const SelectValue = RadixSelect.Value

export function SelectTrigger({
  className,
  children,
  ...props
}: RadixSelect.SelectTriggerProps) {
  return (
    <RadixSelect.Trigger
      className={cn(
        'flex h-9 w-full items-center justify-between rounded-lg border border-white/15 bg-white/5 px-3 py-1 text-sm text-gray-100',
        'placeholder:text-gray-500 ring-offset-transparent transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        '[&>span]:line-clamp-1',
        className,
      )}
      {...props}
    >
      {children}
      <RadixSelect.Icon asChild>
        <ChevronDown size={14} className="text-gray-400" />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  )
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: RadixSelect.SelectContentProps) {
  return (
    <RadixSelect.Portal>
      <RadixSelect.Content
        className={cn(
          'relative z-50 min-w-[8rem] overflow-hidden rounded-xl border border-white/15 bg-gray-900 text-gray-100 shadow-2xl',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        {...props}
      >
        <RadixSelect.Viewport className={cn('p-1', position === 'popper' && 'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]')}>
          {children}
        </RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  )
}

export function SelectItem({
  className,
  children,
  ...props
}: RadixSelect.SelectItemProps) {
  return (
    <RadixSelect.Item
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-lg py-1.5 pl-8 pr-2 text-sm outline-none',
        'focus:bg-white/10 focus:text-white',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <RadixSelect.ItemIndicator>
          <Check size={12} />
        </RadixSelect.ItemIndicator>
      </span>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
    </RadixSelect.Item>
  )
}

export function SelectLabel({ className, ...props }: RadixSelect.SelectLabelProps) {
  return (
    <RadixSelect.Label
      className={cn('py-1.5 pl-8 pr-2 text-xs font-semibold text-gray-500', className)}
      {...props}
    />
  )
}

export function SelectSeparator({ className, ...props }: RadixSelect.SelectSeparatorProps) {
  return (
    <RadixSelect.Separator
      className={cn('-mx-1 my-1 h-px bg-white/10', className)}
      {...props}
    />
  )
}
