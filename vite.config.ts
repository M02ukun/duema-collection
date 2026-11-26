import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base: './' にしておくと GitHub Pages などのサブパスでもそのまま動く
export default defineConfig({
  base: './',
  plugins: [react()],
})
