import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// If you deploy to GitHub Pages at https://<user>.github.io/<repo>/,
// set GH_PAGES=1 when building and put your repo name below.
const repoName = 'HealthyGameMainpage' // <— change if you deploy to another repo

export default defineConfig({
  base: '/Rain-In-Halloween/',
  plugins: [react()],
})

