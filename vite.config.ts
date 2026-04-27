import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  base: '/inscro/',
  build: {
    rollupOptions: {
      input: {
        react: resolve(__dirname, 'examples/react/index.html'),
        vue: resolve(__dirname, 'examples/vue/index.html'),
      },
    },
  },
})
