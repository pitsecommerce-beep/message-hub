export default function LoadingScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gray-950">
      <div className="flex flex-col items-center gap-4">
        <div className="relative h-12 w-12">
          <div className="absolute inset-0 rounded-full border-2 border-brand-600/30" />
          <div className="absolute inset-0 rounded-full border-t-2 border-brand-500 animate-spin" />
        </div>
        <p className="text-sm text-gray-500 animate-pulse">Cargando...</p>
      </div>
    </div>
  )
}
