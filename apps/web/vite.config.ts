import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/message-hub/' : '/',
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
  build: {
    // Larger threshold before warning about chunk size
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // Firebase SDK split so it doesn't block initial render
          'firebase-core': ['firebase/app', 'firebase/auth'],
          'firebase-db': ['firebase/firestore', 'firebase/storage'],
          // Heavy chart library in its own chunk
          'charts': ['recharts'],
          // Radix UI components
          'radix': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-select',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
            '@radix-ui/react-avatar',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-switch',
          ],
          // Table + dnd-kit
          'table': ['@tanstack/react-table', '@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          // React ecosystem
          'vendor': ['react', 'react-dom', 'react-router-dom'],
          // Form + validation
          'forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
  },
})
