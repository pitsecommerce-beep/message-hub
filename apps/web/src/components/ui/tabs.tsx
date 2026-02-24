import * as RadixTabs from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = RadixTabs.Root

export function TabsList({ className, ...props }: RadixTabs.TabsListProps) {
  return (
    <RadixTabs.List
      className={cn(
        'inline-flex h-9 items-center justify-center rounded-lg bg-white/8 p-1 text-gray-400',
        className,
      )}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: RadixTabs.TabsTriggerProps) {
  return (
    <RadixTabs.Trigger
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium',
        'ring-offset-transparent transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        'disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:bg-white/15 data-[state=active]:text-white data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: RadixTabs.TabsContentProps) {
  return (
    <RadixTabs.Content
      className={cn(
        'mt-4 ring-offset-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        className,
      )}
      {...props}
    />
  )
}
