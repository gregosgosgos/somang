// 전시·축제 데이터 수집기
// GitHub Actions가 하루 한 번 실행해 festivals/data/events.json 을 갱신한다.
// 의존성 없음 (Node 20+, 내장 fetch).
//
//   DATA_GO_KR_KEY=<공공데이터포털 인증키> node scripts/collect.mjs
//
// 출처
//   1. 한국관광공사 TourAPI 4.0 searchFestival2 (축제·공연·행사)   — 키 필요
//   2. 한국문화정보원 공연전시정보 period2 (공연·전시)              — 키 필요
//   3. 코엑스 행사일정 (www.coex.co.kr)                            — 키 불필요
//   4. 킨텍스 행사일정 (www.kintex.com)                            — 키 불필요
//   5. 벡스코 행사일정 (www.bexco.co.kr)                           — 키 불필요
//   6. 비짓서울 전시 (korean.visitseoul.net, 서울관광재단)           — 키 불필요
//   7. 멜론티켓 전시/행사 (ticket.melon.com)                        — 키 불필요
//   8. NOL 티켓(옛 인터파크) 전시 (nol.yanolja.com)                 — 키 불필요, playwright 필요
//   9. KOPIS 공연예술통합전산망 (kopis.or.kr)                       — KOPIS_KEY 필요
//
// 티켓 사이트는 개편되면 깨질 수 있다. 출처 하나가 실패해도 나머지는 저장되고,
// 실패한 출처는 이전 파일의 데이터를 유지한다. 실패 내역은 events.json 의 sources 에 남는다.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); // playwright 는 선택 의존성이라 require 로 동적 로드

const OUT = new URL('../festivals/data/events.json', import.meta.url);
const KEY = process.env.DATA_GO_KR_KEY || '';
const KOPIS_KEY = process.env.KOPIS_KEY || '';
// 일부 사이트(킨텍스)는 브라우저가 아닌 UA를 거부하므로 일반 브라우저 UA를 쓴다
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const GW = 'https://apis.data.go.kr';

const today = new Date();
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dashed = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dotted = d => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
const TODAY = ymd(today);
let PREV = null; // 이전 수집 결과 (main 에서 읽어 둠)
const HORIZON = addDays(today, 180); // 앞으로 6개월

const AREA_BY_NAME = [
  ['서울', 1], ['인천', 2], ['대전', 3], ['대구', 4], ['광주', 5], ['부산', 6], ['울산', 7], ['세종', 8],
  ['경기', 31], ['강원', 32], ['충북', 33], ['충청북', 33], ['충남', 34], ['충청남', 34], ['경북', 35], ['경상북', 35],
  ['경남', 36], ['경상남', 36], ['전북', 37], ['전라북', 37], ['전남', 38], ['전라남', 38], ['제주', 39]];
// 주소 없이 장소명만 있을 때 쓰는 유명 장소 → 지역 힌트 (티켓 사이트용)
const VENUE_HINTS = [
  [/경복궁|창덕궁|덕수궁|창경궁|종묘|국립중앙박물관|고궁박물관|북촌|홍대|성수|한남|이태원|잠실|코엑스|DDP|동대문|예술의전당|롯데월드|롯데뮤지엄|더현대|여의도|용산|강남|신촌|합정|을지로|명동|인사동|삼청|청담|압구정|마곡|노들섬|세종문화회관|국립현대미술관 서울|서울시립|그라운드시소|뮤지엄산/, 1],
  [/해운대|광안리|벡스코|부산/, 6], [/킨텍스|일산|고양|수원|용인|성남|판교|파주|광명|안양|부천|과천|에버랜드|뮤지엄 산|원주/, 31],
  [/대구/, 4], [/인천|송도|파라다이스시티/, 2], [/광주/, 5], [/대전/, 3], [/울산/, 7], [/세종/, 8],
  [/제주|서귀포/, 39], [/강릉|속초|춘천|양양|평창|원주|강원/, 32], [/전주|군산|익산|전북/, 37], [/여수|순천|목포|광양|전남/, 38],
  [/경주|포항|안동|구미|경북/, 35], [/창원|김해|진주|통영|거제|경남/, 36], [/청주|충북/, 33], [/천안|아산|공주|보령|충남/, 34],
];
const areaFromText = t => {
  for (const [n, c] of AREA_BY_NAME) if ((t || '').includes(n)) return c;
  for (const [re, c] of VENUE_HINTS) if (re.test(t || '')) return c;
  return 0;
};

function classify(title, realm, fallback = 'fest') {
  const t = `${title || ''} ${realm || ''}`;
  if (/전시|展|갤러리|미술|아트페어|비엔날레|사진전|기획전|특별전|박람회|엑스포|expo|exhibition|페어|fair|쇼\b|show\b|대전\b/i.test(t)) return 'expo';
  if (/축제|페스티벌|페스타|festival|fest\b|불꽃|장터|마켓|빛축제|등축제/i.test(t)) return 'fest';
  if (/연극|뮤지컬|오페라|무용|발레|콘서트|음악|국악|공연|리사이틀|연주회|극장|concert/i.test(t)) return 'show';
  return fallback;
}
// 'YY.MM.DD' 또는 'YYYY.MM.DD' → 'YYYYMMDD'
const ymdLoose = s => { const d = (s || '').replace(/\D/g, ''); return d.length === 6 ? '20' + d : d.slice(0, 8); };
const decodeEntities = s => (s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&(lsquo|rsquo|ldquo|rdquo|middot|hellip|ndash|mdash|bull|times|deg|rarr|larr);/g, (_, k) => ({ lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', hellip: '…', ndash: '–', mdash: '—', bull: '•', times: '×', deg: '°', rarr: '→', larr: '←' }[k]));
const text = s => decodeEntities((s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const digits = s => (s || '').replace(/\D/g, '').slice(0, 8);
// 카드에 보여줄 한 줄 설명: 태그 제거 후 앞부분만
const clip = (s, n = 140) => { const t = text((s || '').replace(/<br\s*\/?>/gi, ' ')); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
// 동시 요청 수를 제한해 상세 페이지를 순회 (실패는 무시)
async function mapPool(items, size, fn, label = '') {
  let i = 0, fail = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; try { await fn(it); } catch { fail++; } }
  }));
  if (label) console.log(`[${label}] 상세 ${items.length}건 중 실패 ${fail}건`);
  return fail;
}

async function get(url, opts = {}) {
  // 네트워크 오류나 5xx 는 최대 3번 재시도 (공공데이터포털 게이트웨이가 가끔 연결을 끊는다)
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko' }, redirect: 'follow', signal: AbortSignal.timeout(60000), ...opts });
      if (res.status >= 500) throw new Error(`${res.status} ${url}`);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const why = body.match(/<returnAuthMsg>([^<]+)|"returnAuthMsg"\s*:\s*"([^"]+)"|<errMsg>([^<]+)/);
        throw Object.assign(new Error(`${res.status} ${why ? (why[1] || why[2] || why[3]) : ''} ${url.split('?')[0]}`.trim()), { noRetry: true });
      }
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (e.noRetry) throw e;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}

let lastDetailError = '';
function explainGatewayLimit(body) {
  const m = body.match(/<returnAuthMsg>([^<]+)|"returnAuthMsg"\s*:\s*"([^"]+)"|<errMsg>([^<]+)|"resultMsg":"([^"]+)"/);
  lastDetailError = m ? (m[1] || m[2] || m[3] || m[4]) : body.slice(0, 80);
  return lastDetailError;
}

// ---------- 1. 한국관광공사 ----------
async function tourApi() {
  if (!KEY) throw Object.assign(new Error('DATA_GO_KR_KEY 없음'), { skipped: true });
  const items = [];
  const base = `${GW}/B551011/KorService2/searchFestival2?serviceKey=${encodeURIComponent(KEY)}&MobileOS=ETC&MobileApp=somang&_type=json&arrange=A&numOfRows=500&eventStartDate=${ymd(addDays(today, -365))}`;
  for (let page = 1; page <= 6; page++) {
    const body = await get(`${base}&pageNo=${page}`);
    let json;
    try { json = JSON.parse(body); } catch { throw new Error('관광공사 응답 해석 실패: ' + body.slice(0, 120)); }
    if (json.response?.header?.resultCode !== '0000') throw new Error('관광공사: ' + json.response?.header?.resultMsg);
    const b = json.response.body;
    for (const it of b?.items?.item || []) {
      items.push({
        id: 'tour-' + it.contentid, src: 'tour', contentId: it.contentid,
        title: it.title, start: it.eventstartdate, end: it.eventenddate,
        place: it.addr1 || '', area: Number(it.areacode) || areaFromText(it.addr1),
        img: it.firstimage || it.firstimage2 || '', tel: it.tel || '',
        lat: it.mapy, lng: it.mapx, kind: classify(it.title),
      });
    }
    if (!b || page * 500 >= (b.totalCount || 0)) break;
  }
  // 이미 끝난 행사는 버리고, 남은 것만 detailCommon2 로 소개글 조회 (일일 호출 한도를 생각해 400건까지)
  const live = items.filter(it => !it.end || it.end >= TODAY);
  const prevById = new Map((PREV?.items || []).filter(p => p.src === 'tour').map(p => [p.id, p]));
  for (const it of live) { const p = prevById.get(it.id); if (p) { if (p.summary) it.summary = p.summary; if (p.homepage) it.homepage = p.homepage; } }
  const need = live.filter(it => !it.summary);
  await mapPool(need.slice(0, 300), 2, async it => {
    let body;
    try { body = await get(`${GW}/B551011/KorService2/detailCommon2?serviceKey=${encodeURIComponent(KEY)}&MobileOS=ETC&MobileApp=somang&_type=json&contentId=${it.contentId}`); }
    catch (e) { lastDetailError = e.message; throw e; }
    const d = JSON.parse(body).response?.body?.items?.item?.[0];
    if (!d) throw new Error(explainGatewayLimit(body));
    if (d?.overview) it.summary = clip(d.overview);
    if (d?.homepage) it.homepage = (d.homepage.match(/href="([^"]+)"/)?.[1] || d.homepage.match(/https?:\/\/\S+/)?.[0] || '').replace(/["<>]/g, '');
  }, 'tour');
  if (need.length && !live.some(it => it.summary)) console.error('[tour] 소개글을 하나도 못 받음:', lastDetailError || '원인 불명');
  return live;
}

// ---------- 2. 한국문화정보원 ----------
async function cultureInfo() {
  if (!KEY) throw Object.assign(new Error('DATA_GO_KR_KEY 없음'), { skipped: true });
  const items = [];
  // 페이지 파라미터는 문서와 달리 numOfrows / PageNo 만 동작한다 (rows, cPage 는 무시됨)
  const base = `${GW}/B553457/cultureinfo/period2?serviceKey=${encodeURIComponent(KEY)}&from=${TODAY}&to=${ymd(HORIZON)}&numOfrows=100&sortStdr=1`;
  for (let page = 1; page <= 20; page++) {
    const xml = await get(`${base}&PageNo=${page}`);
    if (/<(errMsg|returnAuthMsg)>/.test(xml)) throw new Error('문화정보원: ' + (xml.match(/<returnAuthMsg>([^<]+)/)?.[1] || xml.slice(0, 120)));
    const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
    const g = (b, tag) => text(b.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`))?.[1]);
    for (const b of blocks) {
      const title = g(b, 'title'); if (!title) continue;
      const realm = g(b, 'realmName'), place = g(b, 'place'), area = g(b, 'area'), sigungu = g(b, 'sigungu'), service = g(b, 'serviceName');
      items.push({
        id: 'ci-' + (g(b, 'seq') || title), src: 'ci', seq: g(b, 'seq'),
        title, start: digits(g(b, 'startDate')), end: digits(g(b, 'endDate')),
        place: [area, sigungu, place].filter(Boolean).join(' '), area: areaFromText(`${area} ${sigungu} ${place}`),
        img: g(b, 'thumbnail').replace(/^http:\/\//, 'https://'), // 사이트가 https 라 http 이미지는 차단됨
        tel: '', lat: g(b, 'gpsY'), lng: g(b, 'gpsX'),
        homepage: g(b, 'seq') ? `https://www.culture.go.kr/oneCltInfo/oneCltInfoView.do?seq=${g(b, 'seq')}` : '',
        summary: realm && realm !== service ? realm : '',
        kind: service === '전시' ? 'expo' : service === '공연' ? 'show' : classify(title, realm, 'fest'),
      });
    }
    const total = Number(xml.match(/<totalCount>(\d+)/)?.[1] || 0);
    if (blocks.length < 100 || page * 100 >= total) break;
  }
  return items;
}

// ---------- 3. 코엑스 ----------
async function coex() {
  const items = [];
  const q = `search_start_date=${dotted(today)}&search_end_date=${dotted(HORIZON)}&list_type=LIST`;
  for (let page = 1; page <= 15; page++) {
    const html = await get(`https://www.coex.co.kr/event/full-schedules/?var_page=${page}&${q}`);
    const blocks = html.split(/<li class='BlogPost-item'>/).slice(1);
    if (!blocks.length) break;
    for (const b of blocks) {
      const cate = text(b.match(/BlogEventItemCont-cate[^>]*>([^<]*)/)?.[1]);
      if (!/Exhibition/i.test(cate)) continue; // Convention(학회·회의)은 제외
      const title = text(b.match(/BlogEventItemCont-tit'>([\s\S]*?)<\/h4>/)?.[1]);
      const date = b.match(/BlogEventItemCont-date'>\s*([\d.]+)\s*-\s*([\d.]+)/);
      const link = b.match(/href='([^']+)'/)?.[1]?.split('?')[0] || '';
      const hall = text(b.match(/BlogEventItemCont-hall'>([^<]*)/)?.[1]);
      let img = b.match(/<img src='([^']+)' class='BlogEventItemHover-img'/)?.[1] || '';
      if (/\/bg\//.test(img)) img = ''; // 포스터 없을 때 쓰는 배경 이미지는 제외
      else if (img.startsWith('/')) img = 'https://www.coex.co.kr' + img;
      if (!title || !date) continue;
      items.push({
        id: 'coex-' + (link.replace(/\/$/, '').split('/').pop() || title), src: 'coex',
        title, start: digits(date[1]), end: digits(date[2]),
        place: `서울 강남구 코엑스 ${hall}`.trim(), area: 1, img, tel: '', homepage: link,
        lat: '37.5116', lng: '127.0594', kind: 'expo',
      });
    }
    const last = Math.max(...[...html.matchAll(/var_page=(\d+)/g)].map(m => +m[1]), 1);
    if (page >= last) break;
  }
  await mapPool(items, 5, async it => {
    const html = await get(it.homepage);
    const m = html.match(/EventDetailBoxBodyText-txt'>([\s\S]*?)<\/p>/);
    if (m) it.summary = clip(m[1]);
  }, 'coex');
  return items;
}

// ---------- 4. 킨텍스 ----------
async function kintex() {
  const items = [];
  const q = `pageUnit=50&searchStartDt=${dashed(today)}&searchEndDt=${dashed(HORIZON)}&cateAll=&cate=11&cate=23&cate=12&cate=D`;
  for (let page = 1; page <= 10; page++) {
    const html = await get(`https://www.kintex.com/web/ko/event/list.do?pageIndex=${page}&${q}`);
    const blocks = html.split(/<div class="grid-frame-cell/).slice(1);
    if (!blocks.length) break;
    let added = 0;
    for (const b of blocks) {
      const label = text(b.match(/event-label-ko">([^<]*)/)?.[1]);
      if (/회의|컨벤션|학술/.test(label)) continue;
      const title = text(b.match(/item-subject">([\s\S]*?)<\/div>/)?.[1]);
      const date = b.match(/item-date">\s*([\d.]+)\s*~\s*([\d.]+)/);
      const seq = b.match(/fnView\('\.\/view\.do',\s*(\d+)\)/)?.[1] || '';
      const hall = text(b.match(/item-client">([\s\S]*?)<\/div>/)?.[1]).replace(/\s*,\s*/g, ', ');
      const img = b.match(/<img[^>]*src="([^"]+)"/)?.[1] || '';
      if (!title || !date) continue;
      added++;
      items.push({
        id: 'kintex-' + (seq || title), src: 'kintex',
        title, start: digits(date[1]), end: digits(date[2]),
        place: `경기 고양시 킨텍스 ${hall}`.trim(), area: 31,
        img: img.startsWith('http') ? img : 'https://www.kintex.com' + img, tel: '',
        homepage: seq ? `https://www.kintex.com/web/ko/event/view.do?seq=${seq}` : '',
        lat: '37.6690', lng: '126.7450', kind: label.includes('문화') ? classify(title) : 'expo',
      });
    }
    if (blocks.length < 50) break;
  }
  await mapPool(items, 5, async it => {
    if (!it.homepage) return;
    const html = await get(it.homepage);
    const row = label => html.match(new RegExp(`<th[^>]*>\\s*${label}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`))?.[1];
    const d = row('행사목적') || row('행사내용') || row('행사품목');
    if (d) it.summary = clip(d);
  }, 'kintex');
  return items;
}

// ---------- 5. 벡스코 ----------
async function bexco() {
  const items = [];
  for (let page = 1; page <= 40; page++) {
    const html = await get(`https://www.bexco.co.kr/kor/CMS/EventScheduleMgr/list.do?mCode=MN214&page=${page}`);
    const blocks = html.split(/<li>\s*<a href="\/kor\/CMS\/EventScheduleMgr\/view\.do/).slice(1);
    if (!blocks.length) break;
    let past = 0;
    for (const b of blocks) {
      const kindTxt = text(b.match(/eventIcon[^>]*>([^<]*)/)?.[1]);
      if (/회의/.test(kindTxt)) continue;
      const title = text(b.match(/class="subject">([\s\S]*?)<\/span>/)?.[1]);
      const date = b.match(/class="date">\s*([\d-]+)\s*~\s*([\d-]+)/);
      const seq = b.match(/event_seq=(\d+)/)?.[1] || '';
      const place = text(b.match(/class="place">([\s\S]*?)<\/span>/)?.[1]);
      const img = b.match(/<img src="([^"]+)"/)?.[1] || '';
      if (!title || !date) continue;
      const start = digits(date[1]), end = digits(date[2]);
      if (end < TODAY) { past++; continue; }
      if (start > ymd(HORIZON)) continue;
      items.push({
        id: 'bexco-' + (seq || title), src: 'bexco',
        title, start, end,
        place: `부산 해운대구 벡스코 ${place}`.trim(), area: 6,
        img: img.startsWith('http') ? img : 'https://www.bexco.co.kr' + img, tel: '',
        homepage: seq ? `https://www.bexco.co.kr/kor/CMS/EventScheduleMgr/view.do?mCode=MN214&event_seq=${seq}` : '',
        lat: '35.1690', lng: '129.1361', kind: kindTxt === '이벤트' ? classify(title) : 'expo',
      });
    }
    // 목록은 날짜순이므로 한 페이지가 모두 과거면 더 볼 필요 없음
    if (past === blocks.length) break;
    const lastStart = blocks.map(b => digits(b.match(/class="date">\s*([\d-]+)/)?.[1])).filter(Boolean).sort().pop();
    if (lastStart && lastStart > ymd(HORIZON)) break;
  }
  return items;
}

// ---------- 6. 비짓서울 (서울관광재단) ----------
async function visitseoul() {
  const items = [];
  for (let page = 1; page <= 20; page++) {
    const html = await get(`https://korean.visitseoul.net/exhibition?curPage=${page}`);
    const blocks = [...html.matchAll(/listData\.(\w+)\s*=\s*\{([\s\S]*?)\};/g)];
    if (!blocks.length) break;
    const g = (b, k) => decodeEntities(b.match(new RegExp(`${k}\\s*:\\s*'((?:[^'\\\\]|\\\\.)*)'`))?.[1] || '').replace(/\\'/g, "'").trim();
    for (const [, cid, b] of blocks) {
      const title = g(b, 'postSj'); if (!title) continue;
      const start = digits(g(b, 'startDt')), end = digits(g(b, 'endDt'));
      // linkUrl : location.protocol + '//' + location.host + '/exhibition/...'  → 마지막 따옴표 문자열이 경로
      const lastQuoted = k => { const line = b.match(new RegExp(`${k}[^\\n]*`))?.[0] || ''; const q = [...line.matchAll(/'([^']*)'/g)].map(m => m[1]); return (q.pop() || '').replace(/^\/+/, '/'); };
      const link = lastQuoted('linkUrl'), thumb = lastQuoted('thumbUrl');
      items.push({
        id: 'visitseoul-' + cid, src: 'visitseoul',
        title, start, end, place: '서울', area: 1,
        img: thumb && thumb !== '/' ? 'https://korean.visitseoul.net' + thumb : '', tel: '',
        homepage: link && link !== '/' ? 'https://korean.visitseoul.net' + link : '',
        kind: classify(title, '', 'expo'), // ctgryNm 은 '전시&공연'처럼 두 종류를 함께 담고 있어 쓰지 않는다
      });
    }
    const last = Math.max(...[...html.matchAll(/curPage=(\d+)/g)].map(m => +m[1]), 1);
    if (page >= last) break;
  }
  // 상세 페이지에서 장소·주소·전화번호 보강 (실패해도 목록은 유지)
  const dd = (html, label) => text(html.match(new RegExp(`<dt>\\s*${label}\\s*</dt>\\s*<dd>([\\s\\S]*?)</dd>`))?.[1]);
  await mapPool(items, 5, async it => {
    if (!it.homepage) return;
    const html = await get(it.homepage);
    const venue = dd(html, '장소'), addr = dd(html, '주소').replace(/^\d{5}\s*/, ''), tel = dd(html, '전화번호');
    if (venue || addr) it.place = [addr || '서울', venue && !addr.includes(venue) ? venue : ''].filter(Boolean).join(' ');
    if (tel) it.tel = tel;
    const i = html.indexOf('class="se-contents"');
    if (i >= 0) {
      const blk = html.slice(html.indexOf('>', i) + 1, html.indexOf('detial-cont-element', i)).replace(/<style[\s\S]*?<\/style>/g, '');
      const d = clip(blk);
      if (d) it.summary = d;
    }
  }, 'visitseoul');
  return items;
}

// ---------- 7. 멜론티켓 ----------
async function melon() {
  const url = 'https://ticket.melon.com/performance/ajax/prodList.json?commCode=&sortType=HIT&perfGenreCode=GENRE_EXH_ALL&perfThemeCode=&filterCode=FILTER_ALL&v=1';
  const body = await get(url, { headers: { 'User-Agent': UA, Referer: 'https://ticket.melon.com/concert/index.htm?genreType=GENRE_EXH', 'X-Requested-With': 'XMLHttpRequest' } });
  let json;
  try { json = JSON.parse(body); } catch { throw new Error('멜론티켓 응답 해석 실패: ' + body.slice(0, 80)); }
  const list = Array.isArray(json.data) ? json.data : [];
  return list.map(o => {
    const m = (o.periodInfo || '').match(/([\d.]+)\s*-\s*([\d.]+)/);
    return {
      id: 'melon-' + o.prodId, src: 'melon',
      title: text(o.title), start: ymdLoose(m?.[1] || o.periodInfo), end: ymdLoose(m?.[2] || m?.[1] || o.periodInfo),
      place: `${o.regionName || ''} ${o.placeName || ''}`.trim(), area: areaFromText(`${o.regionName} ${o.placeName}`),
      img: o.posterImg ? 'https://cdnticket.melon.co.kr' + o.posterImg : '', tel: '',
      homepage: `https://ticket.melon.com/performance/index.htm?prodId=${o.prodId}`,
      summary: clip(o.summary) || '',
      kind: classify(o.title, '', 'expo'),
    };
  }).filter(it => it.title && it.start);
}

// ---------- 8. NOL 티켓 (헤드리스 브라우저) ----------
async function nol() {
  let pw;
  try { pw = require('playwright'); } catch { throw new Error('playwright 미설치 (npm i playwright && npx playwright install chromium)'); }
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const ctx = await browser.newContext({ locale: 'ko-KR', userAgent: UA, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('https://nol.yanolja.com/ticket/genre/exhibition', { waitUntil: 'networkidle', timeout: 60000 });
    for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 2500); await page.waitForTimeout(500); }
    const raw = await page.evaluate(() => {
      const seen = new Set(), out = [];
      for (const a of document.querySelectorAll('a[aria-label*="공연 기간"]')) {
        if (seen.has(a.href)) continue; seen.add(a.href);
        out.push({ href: a.href, label: a.getAttribute('aria-label'), img: a.querySelector('img')?.getAttribute('src') || '' });
      }
      return out;
    });
    if (!raw.length) throw new Error('NOL 페이지에서 항목을 찾지 못함 (구조 변경?)');
    return raw.map(r => {
      // "제목, 장소, 공연 기간: 26.09.23 ~ 27.03.01"
      const m = r.label.match(/^(.*),\s*([^,]*),\s*공연 기간:\s*([\d.]+)\s*~\s*([\d.]+)\s*$/);
      if (!m) return null;
      const title = text(m[1]).replace(/[\u2800\u3000]+/g, ' ').trim(), place = text(m[2]).replace(/^공연장\s*:\s*/, '');
      return {
        id: 'nol-' + (r.href.match(/products\/(\d+)/)?.[1] || title), src: 'nol',
        title, start: ymdLoose(m[3]), end: ymdLoose(m[4]),
        place, area: areaFromText(`${title} ${place}`), img: r.img, tel: '', homepage: r.href,
        kind: classify(title, '', 'expo'),
      };
    }).filter(Boolean);
  } finally { await browser.close(); }
}

// ---------- 9. KOPIS 공연예술통합전산망 ----------
async function kopis() {
  if (!KOPIS_KEY) throw Object.assign(new Error('KOPIS_KEY 없음'), { skipped: true });
  const items = [];
  for (let page = 1; page <= 30; page++) {
    const xml = await get(`https://www.kopis.or.kr/openApi/restful/pblprfr?service=${encodeURIComponent(KOPIS_KEY)}&stdate=${TODAY}&eddate=${ymd(HORIZON)}&cpage=${page}&rows=100`);
    if (/<errmsg>/.test(xml)) throw new Error('KOPIS: ' + (xml.match(/<errmsg>([^<]+)/)?.[1] || xml.slice(0, 100)));
    const blocks = [...xml.matchAll(/<db>([\s\S]*?)<\/db>/g)].map(m => m[1]);
    const g = (b, tag) => text(b.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`))?.[1]);
    for (const b of blocks) {
      const title = g(b, 'prfnm'); if (!title) continue;
      const area = g(b, 'area'), place = g(b, 'fcltynm'), genre = g(b, 'genrenm');
      items.push({
        id: 'kopis-' + g(b, 'mt20id'), src: 'kopis',
        title, start: digits(g(b, 'prfpdfrom')), end: digits(g(b, 'prfpdto')),
        place: `${area} ${place}`.trim(), area: areaFromText(`${area} ${place}`),
        img: g(b, 'poster'), tel: '', homepage: `https://www.kopis.or.kr/por/db/pblprfr/pblprfrView.do?mt20Id=${g(b, 'mt20id')}`,
        kind: classify(title, genre, 'show'),
      });
    }
    if (blocks.length < 100) break;
  }
  return items;
}

// ---------- 합치기 ----------
// 출처가 달라도 같은 행사면 하나로: 제목에서 연도·회차·판매 꼬리말을 뺀 뒤 기간이 겹치면 같은 행사로 본다
function normTitle(t) {
  return (t || '')
    .replace(/［[^］]*］|\[[^\]]*\]|\([^)]*\)|《[^》]*》|〈[^〉]*〉/g, ' ')
    .replace(/20\d\d년?|제?\s*\d+\s*(회|주년|차|위|일권)|시즌\s*\d+|얼리버드|단독판매|티켓|입장권|굿즈|전용|상품|특별패키지|패키지|할인|\d+%|\b(in|at)\b/gi, ' ')
    .replace(/[^0-9a-z가-힣]/gi, '')
    .toLowerCase();
}
const richness = it => (it.summary ? 4 : 0) + (it.img ? 2 : 0) + (it.homepage ? 1 : 0) + (it.tel ? 1 : 0);
function dedupe(items) {
  const groups = new Map();
  for (const it of items) {
    let k = normTitle(it.title) || it.title;
    // '봉주르 장자크 상페' 와 '봉주르 장자크 상페 세상을 그린 시선' 처럼 한쪽이 다른 쪽의 앞부분이면 같은 행사로 본다
    if (k.length >= 8) for (const key of groups.keys()) if (key.length >= 8 && (key.startsWith(k) || k.startsWith(key))) { k = key; break; }
    if (!groups.has(k)) groups.set(k, []);
    const g = groups.get(k);
    const hit = g.find(o => (it.start || '0') <= (o.end || '9') && (o.start || '0') <= (it.end || '9'));
    if (!hit) { g.push({ ...it }); continue; }
    // 정보가 더 많은 쪽을 기준으로 하고 빈 칸은 다른 쪽에서 채운다. 기간은 둘을 합친다.
    const [base, other] = richness(it) > richness(hit) ? [it, hit] : [hit, it];
    Object.assign(hit, { ...base,
      img: base.img || other.img, homepage: base.homepage || other.homepage, summary: base.summary || other.summary, tel: base.tel || other.tel,
      place: base.place || other.place, area: base.area || other.area, lat: base.lat || other.lat, lng: base.lng || other.lng,
      start: [base.start, other.start].filter(Boolean).sort()[0], end: [base.end, other.end].filter(Boolean).sort().pop(),
    });
  }
  return [...groups.values()].flat();
}

async function main() {
  try { PREV = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
  const all = { tour: tourApi, ci: cultureInfo, coex, kintex, bexco, visitseoul, melon, nol, kopis };
  // SOURCES=coex,nol 처럼 일부만 실행하면 나머지 출처는 이전 파일 데이터를 그대로 둔다 (디버깅용)
  const only = (process.env.SOURCES || '').split(',').map(s => s.trim()).filter(Boolean);
  const sources = only.length ? Object.fromEntries(Object.entries(all).filter(([n]) => only.includes(n))) : all;
  const t0 = Date.now();
  const results = await Promise.allSettled(Object.entries(sources).map(([n, f]) =>
    f().finally(() => console.log(`[${n}] ${((Date.now() - t0) / 1000).toFixed(1)}s`))));
  const names = Object.keys(sources);
  let items = [];
  const report = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') { items = items.concat(r.value); report[names[i]] = r.value.length; }
    else if (r.reason.skipped) report[names[i]] = '건너뜀: ' + r.reason.message;
    else { report[names[i]] = 'ERROR: ' + r.reason.message; console.error(`[${names[i]}]`, r.reason.message); }
  });

  // 실패한 출처는 이전 파일의 데이터로 메운다 (하루 장애로 목록이 비지 않도록)
  const prev = PREV;
  for (const [i, name] of names.entries()) {
    if (results[i].status === 'rejected' && prev?.items) {
      const kept = prev.items.filter(it => it.src === name);
      items = items.concat(kept);
      report[name] += ` (이전 데이터 ${kept.length}건 유지)`;
    }
  }
  for (const name of Object.keys(all)) {
    if (!(name in sources) && prev?.items) {
      items = items.concat(prev.items.filter(it => it.src === name));
      report[name] = prev.sources?.[name] ?? '(건너뜀)';
    }
  }

  items = dedupe(items.filter(it => it.title && it.start && (!it.end || it.end >= TODAY)))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));

  const failedAll = results.every(r => r.status === 'rejected' && !r.reason.skipped);
  if (failedAll) { console.error('모든 출처 실패, 파일을 갱신하지 않습니다.'); process.exit(1); }

  await mkdir(dirname(OUT.pathname), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sources: report,
    items,
  }, null, 0) + '\n');
  console.log(`events.json 저장: ${items.length}건`, report);
}

main().catch(e => { console.error(e); process.exit(1); });
