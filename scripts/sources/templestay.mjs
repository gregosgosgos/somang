// 템플스테이 — 전국 사찰 템플스테이 프로그램 (templestay.com, 한국불교문화사업단)
// 사이트 전체가 접속 대기열(/fe/waiting/page.do → check.do 폴링) 뒤에 있다. 대기열은 공개 방식 그대로 따른다:
// 토큰 쿠키를 받고 서버가 정한 pollInterval 마다 check.do 를 물어 입장(active)되면 목록·상세를 읽는다.
// 혼잡할 때는 입장까지 15~20분 걸릴 수 있어 TEMPLESTAY_MAX_WAIT_MIN(기본 30분) 을 넘기면 빈 배열을 돌려준다.
// 대기열은 예약 몰리는 날 수천 명이 줄을 서므로 기본 8분만 기다린다 (TEMPLESTAY_MAX_WAIT_MIN)
const maxWaitMin = () => Number(process.env.TEMPLESTAY_MAX_WAIT_MIN) || 8;
import { text, clip, areaFromText, mapPool, TODAY, HORIZON, ymd, UA } from '../lib.mjs';

const HOST = 'https://www.templestay.com';
const LIST = `${HOST}/fe/MI000000000000000062/templestay/prgList.do`;
const VIEW = `${HOST}/fe/MI000000000000000062/reserve/view.do`;
// 지역 코드 → 읽을 쪽 수 (한 쪽 6개). 사찰이 많은 도 단위는 2쪽
const AREAS = [['CD00000289', 2], ['CD00000290', 2], ['CD00000291', 2], ['CD00000292', 2], ['CD00000293', 1], ['CD00000294', 1],
  ['CD00000405', 1], ['CD00000296', 1], ['CD00000297', 2], ['CD00000406', 1], ['CD00000404', 1], ['CD00000299', 1],
  ['CD00000300', 2], ['CD00000301', 2], ['CD00000302', 1], ['CD00000303', 2], ['CD00000304', 2]];
const CAP = 150;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeClient() {
  const jar = new Map();
  if (process.env.TEMPLESTAY_COOKIE) for (const kv of process.env.TEMPLESTAY_COOKIE.split(/;\s*/)) { const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  return async function req(url, { json = false, tries = 3 } = {}) {
    for (let a = 1; ; a++) {
      try {
        const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(45000), headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(json ? { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' } : {}) } });
        for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1)); }
        const loc = res.headers.get('location') || '';
        const body = await res.text();
        if (res.status >= 500) throw new Error(`${res.status}`);
        return { status: res.status, loc, body, waiting: /\/waiting\//.test(loc) };
      } catch (e) { if (a >= tries) throw e; await sleep(3000 * a); }
    }
  };
}

async function enterQueue(req) {
  const maxMs = maxWaitMin() * 60000, t0 = Date.now();
  let r = await req(`${HOST}/fe/main/view.do`);
  if (r.status === 200 && !r.waiting) return true; // 대기열이 꺼져 있거나 이미 입장
  await req(`${HOST}/fe/waiting/page.do`); // 대기 토큰(WQ_TOKEN) 발급
  let last = -1;
  while (Date.now() - t0 < maxMs) {
    let d = {};
    try { d = JSON.parse((await req(`${HOST}/fe/waiting/check.do?_=${Date.now()}`, { json: true })).body); } catch { }
    if (d.status === 'active' || d.canEnter) { console.log(`[templestay] 입장 (대기 ${Math.round((Date.now() - t0) / 1000)}초)`); return true; }
    if (d.error === 'no_token') await req(`${HOST}/fe/waiting/page.do`);
    if (d.position && Math.abs(d.position - last) > 300) { console.log(`[templestay] 대기 순번 ${d.position}/${d.totalQueue}`); last = d.position; }
    await sleep(Math.min(Math.max(Number(d.pollInterval) || 30, 10), 60) * 1000);
  }
  console.log(`[templestay] 대기열 ${Math.round(maxMs / 60000)}분 초과 — 건너뜀`);
  return false;
}

function parseList(html) {
  const out = [];
  for (const li of html.split(/<li>\s*<a href="javascript:fncReserve\(/).slice(1)) {
    const m = li.match(/^'(\d+)',\s*'([^']+)'/);
    if (!m) continue;
    const img = li.match(/<img src="(https:\/\/ts-cdn\.com\/ups\/[^"]+)"/)?.[1] || '';
    const addrLine = text(li.match(/alt="주소"><\/span>([^<]+)/)?.[1]);
    out.push({
      seq: m[1], temple: m[2], img, cate: text(li.match(/<span class="cate\d+">([^<]+)/)?.[1]),
      title: text(li.match(/<strong[^>]*>([\s\S]*?)<\/strong>/)?.[1]),
      templeName: addrLine.split(',')[0].trim(), addr: addrLine.split(',').slice(1).join(',').trim() || addrLine,
      tel: text(li.match(/alt="연락처"><\/span>([^<]+)/)?.[1]),
      desc: text(li.match(/<p>([\s\S]*?)<\/p>/)?.[1]),
    });
  }
  return out;
}

export async function templestay() {
  const req = makeClient();
  // 대기열을 시간 안에 못 통과하면 실패로 처리해 수집기가 이전 데이터를 유지하게 한다
  if (!await enterQueue(req)) throw new Error(`접속 대기열을 ${maxWaitMin()}분 안에 통과하지 못함`);
  const hb = setInterval(() => req(`${HOST}/fe/waiting/heartbeat.do`).catch(() => { }), 60000); // 입장 상태 유지
  try {
    const rows = new Map();
    for (const [areaCd, pages] of AREAS) for (let p = 1; p <= pages; p++) {
      const r = await req(`${LIST}?pageIndex=${p}&areaCd=${areaCd}`);
      if (r.waiting) { console.log('[templestay] 세션 만료 — 대기열로 돌아감'); break; }
      const list = parseList(r.body);
      for (const x of list) if (!rows.has(x.seq)) rows.set(x.seq, x);
      if (list.length < 6) break;
      await sleep(400);
    }
    const horizon = ymd(HORIZON);
    const items = [...rows.values()].slice(0, CAP).map(x => ({
      id: `templestay-${x.seq}`, src: 'templestay', title: `${x.title} (${x.templeName})`.replace(/\s+/g, ' '),
      start: TODAY, end: horizon, place: `${x.templeName}, ${x.addr}`, area: areaFromText(x.addr),
      img: x.img, tel: x.tel.split(/[\/,]/)[0].trim(),
      homepage: `${VIEW}?templestaySeq=${x.seq}&templeBookMarkId=${encodeURIComponent(x.temple)}`,
      summary: clip(`템플스테이 ${x.cate || ''} · ${x.desc}`), price: '', kind: 'edu',
    }));
    // 상세: 운영기간, 참가비용(1박 기준 성인)
    await mapPool(items, 2, async it => {
      const r = await req(it.homepage);
      if (r.waiting || r.status !== 200) throw new Error('detail');
      const t = text(r.body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<option[\s\S]*?<\/option>/g, ''));
      const per = t.match(/운영기간\s*:\s*(\d{4})-(\d\d)-(\d\d)\s*~\s*(\d{4})-(\d\d)-(\d\d)/);
      if (per) {
        const s = per.slice(1, 4).join(''), e = per.slice(4, 7).join('');
        if (s > it.start) it.start = s;
        if (e < it.end) it.end = e;
      }
      const fee = t.match(/참가비용\s*(\([^)]*\))?\s*(성인|일반|대인)?\s*([\d,]+)/);
      if (fee && Number(fee[3].replace(/,/g, ''))) it.price = `${fee[2] || '성인'} ${fee[3]}원${fee[1] ? ' ' + fee[1] : ''}`;
    }, 'templestay');
    return items.filter(it => it.end >= TODAY && it.start <= it.end && it.start <= horizon);
  } finally { clearInterval(hb); }
}
