// 자동 생성(웹배포/_웹올리기.py) — 내용 해시로 판 번호를 매긴다
const CACHE = 'studyapps-2a9328c7da';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  // cache:'reload' — 설치 때 브라우저 HTTP 캐시의 옛 파일을 줍지 않도록 강제로 다시 받는다
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, {cache: 'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 화면과 자료는 '있는 것을 먼저 보여 주고 뒤에서 새것을 받아 둔다'(stale-while-revalidate).
// 캐시만 보고 끝내면 새 판을 올려도 옛 화면이 계속 뜨고, 그물만 보면 3MB 짜리 앱이 매번 다시 내려온다.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const 새로받아둠 = e.request.mode === 'navigate' ||
    /\.(?:html|json)$/.test(url.pathname) || url.pathname.endsWith('/');
  e.respondWith(caches.open(CACHE).then(c => c.match(e.request, {ignoreSearch: true}).then(hit => {
    if (hit && !새로받아둠) return hit;        // 스크립트·그림은 판마다 캐시 이름이 바뀌니 그대로 쓴다
    const 그물 = fetch(e.request).then(r => {
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }).catch(() => hit || (e.request.mode === 'navigate' ? c.match('./index.html') : undefined));
    if (!hit) return 그물;
    그물.catch(() => {});                      // 뒤에서 받아 두고, 다음에 열 때 새것이 뜬다
    return hit;
  })));
});
