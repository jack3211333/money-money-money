const CACHE = 'money-money-money-v3'
const APP_SHELL = ['/manifest.webmanifest', '/favicon.svg']
const timeout = () => new Promise((_, reject) => setTimeout(() => reject(new Error('network timeout')), 4000))

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return
  if (event.request.mode === 'navigate') {
    event.respondWith(Promise.race([fetch(event.request), timeout()]).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put('/', response.clone()))
      return response
    }).catch(async () => (await caches.match('/')) || Response.error()))
    return
  }
  event.respondWith(Promise.race([fetch(event.request), timeout()]).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()))
    return response
  }).catch(async () => (await caches.match(event.request)) || Response.error()))
})
