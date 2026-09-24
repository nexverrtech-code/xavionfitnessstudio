import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/**
 * Tiny PWA + Cloudflare Pages plugin (no extra dependencies):
 *  - emits /sw.js with a versioned cache name and the app-shell precache list
 *  - emits /_headers with security headers, a CSP that allows the API origin,
 *    and long-lived immutable caching for hashed assets
 */
function smartgymPwa(apiUrl: string): Plugin {
  return {
    name: 'smartgym-pwa',
    apply: 'build',
    transformIndexHtml(html) {
      // Same origin (/api on this domain): the installable app is named after the gym, live
      // from Settings. Another API origin keeps the static fallback manifest.
      if (/^https?:\/\//.test(apiUrl)) return html
      return html.replace('<link rel="manifest" href="/manifest.webmanifest" />', '<link rel="manifest" href="/api/manifest.webmanifest" />')
    },
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
      const version = createHash('sha256').update(files.sort().join('|')).digest('hex').slice(0, 12)
      const template = readFileSync(fileURLToPath(new URL('./src/sw/sw.template.js', import.meta.url)), 'utf8')
      // The shell is the entry chunk plus everything it statically imports (runtime,
      // router, shared vendor chunks) and its CSS; lazy route chunks are cached on use.
      const shell = new Set<string>()
      const visit = (fileName: string) => {
        const file = bundle[fileName]
        if (!file || shell.has(fileName)) return
        shell.add(fileName)
        if (file.type === 'chunk') {
          file.imports.forEach(visit)
          file.viteMetadata?.importedCss.forEach((css) => shell.add(css))
        }
      }
      for (const file of Object.values(bundle)) if (file.type === 'chunk' && file.isEntry) visit(file.fileName)
      // "/" only: Cloudflare Pages redirects /index.html to /, and a redirected response
      // can't be used to answer a navigation.
      const precache = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', ...[...shell].map((f) => `/${f}`)]
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache)),
      })
      // An empty VITE_API_URL means same-origin (/api on this domain), already covered by 'self'.
      const apiOrigin = /^https?:\/\//.test(apiUrl) ? new URL(apiUrl).origin : ''
      // Allow only the exact inline theme bootstrap script in index.html (by hash).
      const html = readFileSync(fileURLToPath(new URL('./index.html', import.meta.url)), 'utf8')
      const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
        (m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`,
      )
      const csp = [
        "default-src 'self'",
        `script-src 'self' ${inline.join(' ')}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        `connect-src 'self' ${apiOrigin}`.trim(),
        "frame-src 'none'",
        "worker-src 'self'",
        "manifest-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; ')
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: [
          '/*',
          `  Content-Security-Policy: ${csp}`,
          '  X-Content-Type-Options: nosniff',
          '  X-Frame-Options: DENY',
          '  Referrer-Policy: strict-origin-when-cross-origin',
          '  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()',
          '',
          '/assets/*',
          '  Cache-Control: public, max-age=31536000, immutable',
          '',
          '/sw.js',
          '  Cache-Control: no-cache',
          '',
          '/index.html',
          '  Cache-Control: no-cache',
          '',
        ].join('\n'),
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), tailwindcss(), smartgymPwa(env.VITE_API_URL ?? '')],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // With VITE_API_URL empty the app calls /api on its own origin; the dev server forwards
    // those calls to the local Worker, the same shape as a gymname.com/api/* Worker route.
    server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
    preview: { port: 4173 },
    build: {
      target: 'es2022',
      cssCodeSplit: true,
      sourcemap: false,
      chunkSizeWarningLimit: 600,
      rolldownOptions: {
        output: {
          // Stable vendor chunks: a deploy that only changes app code leaves these hashes
          // alone, so returning users re-download just the app.
          codeSplitting: {
            groups: [
              { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 20 },
              { name: 'router', test: /[\\/]node_modules[\\/]react-router[\\/]/, priority: 10 },
            ],
          },
        },
      },
    },
  }
})
