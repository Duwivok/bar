const CACHE_VERSION = 'v19';
const CACHE_NAME = 'bar-calc-' + CACHE_VERSION;

const APP_SHELL = [
    'index.html',
    'recipes.html',
    'recipes-v2.html',
    'calculator.html',
    'calculator-v2.html',
    'events.html',
    'events-v2.html',
    'event.html',
    'event-v2.html',
    'ingredients.html',
    'ingredients-v2.html',
    'converter.html',
    'converter-v2.html',
    'manifest.json',
    'css/styles.css',
    'css/styles-v2.css',
    'css/event-v2.css',
    'css/events-v2.css',
    'js/constants.js',
    'js/format.js',
    'js/supabase-client.js',
    'js/search-clear.js',
    'js/multiselect.js',
    'js/recipes.js',
    'js/recipes-v2.js',
    'js/recipe-detail.js',
    'js/calculator.js',
    'js/calculator-v2.js',
    'js/events.js',
    'js/events-v2.js',
    'js/event.js',
    'js/event-v2.js',
    'js/event-calc.js',
    'js/event-calc-v2.js',
    'js/converter.js',
    'js/ingredients.js',
    'images/home-banner.jpg',
    'icons/icon-192.png',
    'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return; // не трогаем Supabase и CDN

    // HTML/CSS/JS — код и разметка приложения — всегда идём в сеть в первую очередь.
    // Раньше эти запросы отдавались "сначала из кэша" (stale-while-revalidate), из-за чего
    // после правки events.js (маршрутизация v1/v2 карточки мероприятия) телефоны с уже
    // установленным приложением продолжали получать старый закэшированный JS ещё какое-то
    // время — обновление подтягивалось только "со второго раза". Кэш здесь — только офлайн-фолбэк.
    const isCode = request.mode === 'navigate' || /\.(html|css|js)$/.test(url.pathname);
    if (isCode) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(() => caches.match(request).then((cached) => cached || caches.match('index.html')))
        );
        return;
    }

    // Картинки/иконки/манифест — тяжёлые и редко меняются, тут кэш-сначала оправдан.
    event.respondWith(
        caches.match(request).then((cached) => {
            const fetchPromise = fetch(request).then((response) => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                return response;
            }).catch(() => cached);
            return cached || fetchPromise;
        })
    );
});
