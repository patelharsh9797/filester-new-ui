import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const server = `http://127.0.0.1:${process.env.SERVER_PORT || 8787}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/proxy': { target: server, changeOrigin: true },
      '/local': { target: server, changeOrigin: true },
    },
  },
})
