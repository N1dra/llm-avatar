// 오프라인 캐시만 든다. 기능을 걸지 않는다 -- 앱 껍데기의 아이폰 판은 서비스
// 워커를 안 돌리므로, 여기에 기댄 기능은 싼 앱에서 말없이 사라진다.
// 캐시 이름을 올리면 새 판이 깔린다. 파일을 고쳐 배포할 때 함께 올린다.
const CACHE_NAME = 'lvm-shell-v158';
// 폰 안 받아쓰기의 엔진과 모델(stt/kit-dolphin, 263 MB 남짓)은 따로 담는다. 앱 판을 올릴 때마다 지우면 그때마다 다시 받는다 --
// 받는 자리가 PC(이 앱을 내주는 곳)라 PC 가 꺼진 때 판이 오르면 폰 받아쓰기가 통째로 사라진다. 이 파일들은 안 바뀌므로
// 캐시 먼저로 준다. 바꿀 때는 폴더 이름과 이 이름을 함께 바꾼다 (stt/kit-dolphin/출처.txt) -- 이름이 바뀐 옛 캐시는 아래
// activate 가 지운다 (앞 판 lvm-stt-kit-ko 의 moonshine + whisper-base 160 MB 가 그렇게 걷힌다).
// 한 엔진(engine/kit-one -- 받아쓰기와 목소리를 한 WASM 에, 15 MB)도 이 캐시에 담는다. 받아쓰기 모델은 그대로라 다시 안 받고,
// 앞 판의 받아쓰기 전용 엔진 파일은 app.js 키트치우기 가 걷는다.
const KIT_CACHE = 'lvm-stt-kit-dolphin';
// 폰 안 목소리의 모델(tts/kit-st, 145 MB 남짓)도 같은 까닭으로 따로 캐시 먼저로 담는다 (tts/kit-st/출처.txt). 앞 판의 목소리 전용
// 묶음(lvm-tts-kit-supertonic)은 이름이 바뀌어 activate 가 지운다.
const TTS_CACHE = 'lvm-tts-kit-st';
const 꾸러미들 = [['/stt/kit-dolphin/', KIT_CACHE], ['/engine/kit-one/', KIT_CACHE], ['/tts/kit-st/', TTS_CACHE]];
const SHELL = [
  './', './index.html', './styles.css', './app.js', './shell.js', './brain.js', './keybox.js', './sw-reg.js',
  './face/tune.js', './engine/worker.js', './face/avatar-vrm.js', './manifest.json', './icons/icon.svg',
  './vendor/three/build/three.module.js',
  './vendor/three/examples/jsm/loaders/GLTFLoader.js',
  './vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
  './vendor/@pixiv/three-vrm/lib/three-vrm.module.js',
];
// 새 판은 다 받은 뒤 기다림 칸에 선다 -- 넘어갈지는 사람이 고른다 (sw-reg.js 새판살피기 가 묻고 '판받기' 를 보낸다).
// 처음 깔릴 때(앞 워커가 없을 때)는 기다림 없이 바로 선다.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)));
});
self.addEventListener('message', (e) => { if (e.data === '판받기') self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE_NAME && k !== KIT_CACHE && k !== TTS_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// 망 먼저, 못 닿으면 캐시. 앱 파일은 늘 새것을 받고, 망이 없거나 늦을 때만 지난 것을 쓴다.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const 꾸러미 = 꾸러미들.find(([자리]) => new URL(e.request.url).pathname.includes(자리));
  if (꾸러미) {
    // 앱이 받으며 제가 담는 요청(x-kit-app 머리, app.js 받으며담기)은 여기서 또 담지 않는다 -- 같은 수백 MB 를 두 번 쓰게 된다.
    const 앱이담음 = e.request.headers.has('x-kit-app');
    e.respondWith(caches.open(꾸러미[1]).then(async (x) => {
      // 조각을 받는 요청(Range)은 담긴 것을 안 준다 -- 담긴 통째 파일을 주면 받는 쪽이 206 이 아니라 어긋난다.
      const 범위 = e.request.headers.has('range');
      const hit = !범위 && await x.match(e.request);
      if (hit) return hit;
      const 조각 = !범위 && await 조각으로(x, e.request.url);
      if (조각) return 조각;
      const r = await fetch(e.request);
      if (r.ok && r.status === 200 && r.type === 'basic' && !앱이담음) x.put(e.request, r.clone());
      return r;
    }));
    return;
  }
  e.respondWith(망먼저(e.request));
});
// 큰 꾸러미 파일은 8 MB 조각으로 담겨 있다 (app.js 받으며담기 -- 열쇠 '주소?part=k&of=n', 다 모이면 조각표 '주소?parts').
// 조각표가 있으면 조각을 차례로 이어 한 파일처럼 흘려 준다. 한 벌만 담기고, 큰 덩어리를 한 번에 메모리에 안 올린다.
async function 조각으로(x, 주소) {
  주소 = 주소.split('?')[0];
  const 표 = await x.match(주소 + '?parts');
  if (!표) return null;
  const n = Number(표.headers.get('x-kit-parts')) || 0;
  let k = 0;
  const 흐름 = new ReadableStream({
    async pull(ctl) {
      if (k >= n) { ctl.close(); return; }
      const r = await x.match(주소 + '?part=' + k + '&of=' + n);
      k++;
      if (!r) { ctl.error(new Error('조각 없음 ' + (k - 1))); return; }
      ctl.enqueue(new Uint8Array(await r.arrayBuffer()));
    },
  });
  return new Response(흐름, { status: 200, headers: {
    'content-type': 표.headers.get('x-kit-type') || 'application/octet-stream', 'content-length': 표.headers.get('x-kit-size') || '' } });
}
// 망에 3 초 안에 답이 없고 캐시에 있으면 캐시로 준다. PC 가 꺼져 있으면 사설 망은 바로 끊지 않고 답 없이 매달려,
// 기다림을 안 끊으면 앱이 뜨기까지 수십 초가 간다. 캐시에 없으면 망을 끝까지 기다린다 (줄 것이 그것뿐이다).
// 늦게 온 망 답도 캐시에 담는다 -- 다음에 뜰 때는 그것이 나간다.
const 망기다림 = 3000;
function 망먼저(req) {
  const 망 = fetch(req).then((r) => {
    if (r.ok && r.type === 'basic') { const c = r.clone(); caches.open(CACHE_NAME).then((x) => x.put(req, c)); }
    return r;
  });
  return new Promise((ok, no) => {
    let 끝 = false;
    const 캐시로 = () => caches.match(req).then((hit) => {
      if (끝) return;
      if (hit) { 끝 = true; ok(hit); }
    });
    const 시계 = setTimeout(캐시로, 망기다림);
    // 망 답이 서버 오류(5xx)면 담아 둔 것이 있을 때 그것을 준다. PC 가 켜져 사설 망 앞단은 살아 있는데 앱 서버(serve.js)가 꺼져
    // 있으면 앞단이 502 를 돌려주고, 그것을 그대로 주면 받아 둔 앱이 있어도 흰 화면이 된다. 담아 둔 것이 없으면 오류 그대로 준다.
    망.then((r) => {
      clearTimeout(시계);
      if (끝) return;
      if (r.status < 500) { 끝 = true; ok(r); return; }
      caches.match(req).then((hit) => { if (!끝) { 끝 = true; ok(hit || r); } });
    },
      () => { clearTimeout(시계); caches.match(req).then((hit) => { if (!끝) { 끝 = true; hit ? ok(hit) : no(new TypeError('망도 캐시도 없음')); } }); });
  });
}
