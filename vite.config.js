import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ❗ replace YOUR_GH_USERNAME and YOUR_REPO_NAME
export default defineConfig({
  plugins: [react()],
  base: '/HealthyGameMainpage/', // e.g. '/kids-healthy-games/'
})

