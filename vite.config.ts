import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Generate source maps for production debugging
    sourcemap: true,
    // Code splitting — engines load lazily
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React
          'vendor-react': ['react', 'react-dom'],
          // State management
          'vendor-zustand': ['zustand'],
          // Storage layer
          'vendor-dexie': ['dexie', 'dexie-react-hooks'],
        },
      },
    },
  },
  // Source maps in development for readable stack traces
  css: {
    devSourcemap: true,
  },
})
