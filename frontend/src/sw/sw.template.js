/* SmartGym service worker (generated at build time from src/sw/sw.template.js).
 *
 * - App shell + entry bundle are precached for instant, offline-capable reopening.
 * - Hashed /assets/* are cache-first (immutable); lazy route chunks are cached on first use.
 * - Navigations are network-first (fresh deploys) with an offline fallback to the shell.
 * - The API (/api or its own origin) and every non-GET request always go to the network:
 *   payments, memberships, attendance writes and admin changes never work offline.
 */
const VERSION = '__VERSION__'
const SHELL = `smartgym-shell-${VERSION}`
const RUNTIME = `smartgym-runtime-${VERSION}`
const PRECACHE = __PRECACHE__

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key.startsWith('smartgym-') && key !== SHELL && key !== RUNTIME).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

// On the very first visit the page loads before this worker takes control, so the
// page posts the asset URLs it already fetched; caching them makes the next open
// work offline too.
self.addEventListener('message', (event) => {
  const urls = event.data && event.data.type === 'CACHE_URLS' && Array.isArray(event.data.urls) ? event.data.urls : []
  const own = urls.filter((u) => {
    try {
      const url = new URL(u, self.location.origin)
      return url.origin === self.location.origin && url.pathname.startsWith('/assets/')
    } catch {
      return false
    }
  })
  if (!own.length) return
  event.waitUntil(
    caches.open(RUNTIME).then((cache) =>
      Promise.all(own.map((u) => caches.match(u).then((hit) => hit || fetch(u).then((response) => (isAsset(response) ? cache.put(u, response) : undefined))).catch(() => undefined))),
    ),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // API on another origin: network only
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return // same-origin API

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request))
  } else if (/\.(png|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request))
  }
})

async function networkFirst(request) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3500)
    const response = await fetch(request, { signal: controller.signal })
    clearTimeout(timer)
    return response
  } catch {
    const shell = await caches.open(SHELL)
    return (await shell.match('/')) || Response.error()
  }
}

// Pages answers unknown paths (e.g. a chunk from a previous deploy) with index.html
// and status 200 — never cache that as a script.
function isAsset(response) {
  return response.ok && !(response.headers.get('content-type') || '').includes('text/html')
}

async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (isAsset(response)) {
    const cache = await caches.open(RUNTIME)
    cache.put(request, response.clone())
  }
  return response
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request)
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) (await caches.open(RUNTIME)).put(request, response.clone())
      return response
    })
    .catch(() => cached)
  return cached || refresh
}
