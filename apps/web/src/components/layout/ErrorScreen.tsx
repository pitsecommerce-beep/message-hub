import { type FallbackProps } from 'react-error-boundary'
import { Button } from '@/components/ui/button'

export default function ErrorScreen({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gray-950">
      <div className="flex flex-col items-center gap-4 text-center max-w-sm px-4">
        <div className="text-4xl">⛔</div>
        <h1 className="text-xl font-semibold text-white">Algo salió mal</h1>
        <p className="text-sm text-gray-400">
          {error instanceof Error ? error.message : 'Error desconocido'}
        </p>
        <Button onClick={resetErrorBoundary}>Intentar de nuevo</Button>
      </div>
    </div>
  )
}
