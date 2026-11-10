import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// 建置時產生 iPhone 小工具（Scriptable）腳本 /money-widget.js，填入公開的 Supabase URL、Publishable key 與正式網址。
const widgetScript = (env: Record<string, string>): Plugin => ({
  name: 'money-widget-script',
  apply: 'build',
  generateBundle() {
    const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL
    const source = readFileSync('widget/money-widget.js', 'utf8')
      .replace('__SUPABASE_URL__', env.VITE_SUPABASE_URL ?? '')
      .replace('__SUPABASE_PUBLISHABLE_KEY__', env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '')
      .replace('__APP_URL__', productionHost ? `https://${productionHost}/` : '')
    this.emitFile({ type: 'asset', fileName: 'money-widget.js', source })
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), widgetScript({ ...loadEnv(mode, process.cwd(), 'VITE_'), ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_'))) as Record<string, string> })],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        quickAdd: 'quick-add.html',
      },
    },
  },
}))
