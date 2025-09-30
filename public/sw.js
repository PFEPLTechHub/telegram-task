const CACHE_NAME = 'task-management-v2';
const urlsToCache = [
  '/css/task-view.css',
  '/js/task-view.min.js',
  'https://unpkg.com/preact@10.22.0/dist/preact.umd.js',
  'https://unpkg.com/preact@10.22.0/hooks/dist/hooks.umd.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      }
    )
  );
});
