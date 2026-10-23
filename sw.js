// 자동 생성(웹배포/_웹올리기.py) — 내용 해시로 판 번호를 매긴다
const CACHE = 'studyapps-e97e7a24e2';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  // cache:'reload' — 설치 때 브라우저 HTTP 캐시의 옛 파일을 줍지 않도록 강제로 다시 받는다
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, {ignoreSearch: true}).then(hit => hit ||
      fetch(e.request).then(r => {
        if (r.ok && new URL(e.request.url).origin === location.origin) {
          const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp));
        }
        return r;
      }).catch(() => e.request.mode === 'navigate' ? caches.match('./index.html') : undefined)
    )
  );
});
