// 전시·축제 데이터 수집기
// GitHub Actions가 하루 한 번 실행해 festivals/data/events.json 을 갱신한다.
// 의존성 없음 (Node 20+, 내장 fetch).
//
//   DATA_GO_KR_KEY=<공공데이터포털 인증키> node scripts/collect.mjs
//
// 출처 (괄호는 키 필요 여부)
//   공공: 관광공사 TourAPI·문화정보원 공연전시 (DATA_GO_KR_KEY), KOPIS (KOPIS_KEY), 서울문화포털, 경기문화재단,
//         문체부 문화관광축제·지역축제 개최계획, 전국전통시장 표준데이터 5일장, 국립공원 탐방프로그램, 숲나들e 휴양림 프로그램,
//         국립중앙도서관 행사, KOBIZ 영화제
//   전시장: 코엑스, 킨텍스, 벡스코 / 관광: 비짓서울
//   티켓: 멜론티켓·NOL 티켓(playwright) 전 장르, 네이버 스포츠 경기 일정, LoL e스포츠 일정
//   체험: 프립, 솜씨당, 웰촌 농촌체험, 템플스테이(접속 대기열), 마라톤온라인, 에버랜드·롯데월드, 알라딘 작가 행사
//   팝업: 팝플리
//   이 파일 안의 출처 외에는 scripts/sources/ 에 한 파일씩 있다.
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
// 새 출처는 scripts/sources/ 에 한 파일씩 둔다
import { lck } from './sources/lck.mjs';
import { sports } from './sources/sports.mjs';
import { marathon } from './sources/marathon.mjs';
import { themepark } from './sources/themepark.mjs';
import { seoul } from './sources/seoul.mjs';
import { gyeonggi } from './sources/gyeonggi.mjs';
import { famousfest, famousMatch } from './sources/famousfest.mjs';
import { market5 } from './sources/market5.mjs';
import { booktalk } from './sources/booktalk.mjs';
import { filmfest } from './sources/filmfest.mjs';
import { fleamarket } from './sources/fleamarket.mjs';
import { frip } from './sources/frip.mjs';
import { sssd } from './sources/sssd.mjs';
import { welchon } from './sources/welchon.mjs';
import { knps } from './sources/knps.mjs';
import { foresttrip } from './sources/foresttrip.mjs';
import { templestay } from './sources/templestay.mjs';
import { UA, GW, today, pad, ymd, addDays, dashed, dotted, TODAY, HORIZON, AREA_BY_NAME, VENUE_HINTS, areaFromText, classify, ymdLoose, decodeEntities, text, digits, clip, mapPool, get } from './lib.mjs';
let PREV = null; // 이전 수집 결과 (main 에서 읽어 둠)

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
        homepage: '', // 문화포털에는 상세 페이지가 없다. 아래 detail2 의 관람URL(원문)을 쓴다
        summary: realm && realm !== service ? realm : '',
        kind: service === '전시' ? 'expo' : service === '공연' ? 'show' : service === '교육/체험' ? 'edu' : classify(title, realm, 'fest'),
      });
    }
    const total = Number(xml.match(/<totalCount>(\d+)/)?.[1] || 0);
    if (blocks.length < 100 || page * 100 >= total) break;
  }
  // 목록에는 링크가 없어 detail2 로 관람URL·소개·요금·문의처를 받는다. 이미 받은 항목은 이전 파일에서 이어받고,
  // 새 항목만 조회한다 (일일 호출 한도를 생각해 한 번에 CI_DETAIL_LIMIT 건, 기본 700).
  const live = items.filter(it => !it.end || it.end >= TODAY);
  const prevById = new Map((PREV?.items || []).filter(p => p.src === 'ci').map(p => [p.id, p]));
  for (const it of live) {
    const p = prevById.get(it.id);
    if (!p || !p.detail) continue;
    it.detail = true;
    if (p.homepage && !/culture\.go\.kr\/oneCltInfo/.test(p.homepage)) it.homepage = p.homepage.replace(/&amp;/gi, '&').replace(/&amp;/gi, '&');
    if (p.summary) it.summary = p.summary;
    if (p.price) it.price = p.price;
    if (p.tel) it.tel = p.tel;
  }
  const need = live.filter(it => !it.detail && it.seq);
  let ok = 0;
  const limit = Number(process.env.CI_DETAIL_LIMIT || 700);
  const failed = await mapPool(need.slice(0, limit), 1, async it => {
    let xml;
    try { xml = await get(`${GW}/B553457/cultureinfo/detail2?serviceKey=${encodeURIComponent(KEY)}&seq=${it.seq}`); }
    catch (e) { lastDetailError = e.message; throw e; }
    if (/<(errMsg|returnAuthMsg|resultMsg)>/.test(xml) && !/<item>/.test(xml)) throw new Error(explainGatewayLimit(xml));
    if (!/<item>/.test(xml)) { lastDetailError = '응답에 item 없음: ' + xml.slice(0, 160).replace(/\s+/g, ' '); throw new Error(lastDetailError); }
    const g = tag => text(xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`))?.[1]);
    const unamp = u => { let t = u; while (/&amp;/i.test(t)) t = t.replace(/&amp;/gi, '&'); return t; }; // 원문 URL 에 &amp; 가 이중으로 들어오는 경우가 있다
    const url = unamp((g('url') || g('placeUrl') || '').trim());
    if (/^https?:\/\//.test(url) && !/culture\.go\.kr\/oneCltInfo/.test(url)) it.homepage = url;
    const body = clip(g('contents1'));
    if (body) it.summary = it.summary ? `${it.summary} · ${body}` : body;
    const price = g('price'); if (price) it.price = price.slice(0, 200);
    const phone = g('phone'); if (phone) it.tel = phone.slice(0, 60);
    if (!it.img && g('imgUrl')) it.img = g('imgUrl').replace(/^http:\/\//, 'https://');
    it.detail = true; ok++;
  }, 'ci');
  if (need.length) console.log(`[ci] 상세 ${ok}/${Math.min(need.length, limit)}건 조회, 남은 미조회 ${need.length - ok}건`);
  if (failed) console.error(`[ci] 상세 실패 ${failed}건, 마지막 오류:`, lastDetailError || '원인 불명');
  return live;
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
// 장르별로 받아 합친다. summary 첫 토막은 페이지의 공연 장르 판정(REALM_GENRE)에 쓰인다.
const MELON_GENRES = [
  ['GENRE_EXH_ALL', 'expo', '전시/행사'], ['GENRE_CON_ALL', 'show', '음악/콘서트'], ['GENRE_ART_ALL', 'show', '뮤지컬/오페라'],
  ['GENRE_CLA_ALL', 'show', '클래식'], ['GENRE_FAN_ALL', 'show', '팬미팅'],
];
// 좌석 등급별 가격 → "R석 99,000원 / S석 77,000원" (AI 의 비용 판정에 쓰인다)
function melonPrice(json) {
  try {
    const list = JSON.parse(json || '{}')?.data?.list || [];
    return list.filter(x => Number(x.basePrice) > 0).slice(0, 3).map(x => `${x.seatGradeName || ''} ${Number(x.basePrice).toLocaleString('ko-KR')}원`.trim()).join(' / ');
  } catch { return ''; }
}
async function melon() {
  const out = [];
  for (const [code, kind, label] of MELON_GENRES) {
    const url = `https://ticket.melon.com/performance/ajax/prodList.json?commCode=&sortType=HIT&perfGenreCode=${code}&perfThemeCode=&filterCode=FILTER_ALL&v=1`;
    const body = await get(url, { headers: { 'User-Agent': UA, Referer: 'https://ticket.melon.com/concert/index.htm', 'X-Requested-With': 'XMLHttpRequest' } });
    let json;
    try { json = JSON.parse(body); } catch { throw new Error('멜론티켓 응답 해석 실패: ' + body.slice(0, 80)); }
    for (const o of Array.isArray(json.data) ? json.data : []) {
      const m = (o.periodInfo || '').match(/([\d.]+)\s*-\s*([\d.]+)/);
      const desc = clip(o.summary);
      out.push({
        id: 'melon-' + o.prodId, src: 'melon',
        title: text(o.title), start: ymdLoose(m?.[1] || o.periodInfo), end: ymdLoose(m?.[2] || m?.[1] || o.periodInfo),
        place: `${o.regionName || ''} ${o.placeName || ''}`.trim(), area: areaFromText(`${o.regionName} ${o.placeName}`),
        img: o.posterImg ? 'https://cdnticket.melon.co.kr' + o.posterImg : '', tel: '',
        homepage: `https://ticket.melon.com/performance/index.htm?prodId=${o.prodId}`,
        summary: desc ? `${label} · ${desc}` : label,
        price: melonPrice(o.seatGradeJson),
        kind: kind === 'expo' ? classify(o.title, '', 'expo') : 'show',
      });
    }
  }
  return out.filter(it => it.title && it.start);
}

// ---------- 8. NOL 티켓 (헤드리스 브라우저) ----------
// 장르 페이지마다 같은 구조 (카드 링크의 aria-label 에 "제목, 장소, 공연 기간: 26.09.23 ~ 27.03.01")
const NOL_GENRES = [
  ['exhibition', 'expo', '전시/행사'], ['musical', 'show', '뮤지컬/오페라'], ['concert', 'show', '음악/콘서트'],
  ['play', 'show', '연극'], ['classic', 'show', '클래식'], ['family', 'show', '아동/가족'],
];
async function nol() {
  let pw;
  try { pw = require('playwright'); } catch { throw new Error('playwright 미설치 (npm i playwright && npx playwright install chromium)'); }
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const out = [], failed = [];
  try {
    const ctx = await browser.newContext({ locale: 'ko-KR', userAgent: UA, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    for (const [slug, kind, label] of NOL_GENRES) {
      try {
        // networkidle 은 콘서트 페이지의 유튜브 영상 때문에 끝나지 않으므로 카드가 뜰 때까지만 기다린다
        await page.goto(`https://nol.yanolja.com/ticket/genre/${slug}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('a[aria-label*="공연 기간"]', { timeout: 20000 }).catch(() => {});
        // 아래로 내릴 때마다 카드가 더 붙으므로, 개수가 더 늘지 않을 때까지 내린다
        for (let i = 0, last = -1, same = 0; i < 30 && same < 3; i++) {
          await page.mouse.wheel(0, 3000); await page.waitForTimeout(500);
          const n = await page.$$eval('a[aria-label*="공연 기간"]', as => new Set(as.map(a => a.href)).size);
          same = n === last ? same + 1 : 0; last = n;
        }
        const raw = await page.evaluate(() => {
          const seen = new Set(), list = [];
          for (const a of document.querySelectorAll('a[aria-label*="공연 기간"]')) {
            if (seen.has(a.href)) continue; seen.add(a.href);
            list.push({ href: a.href, label: a.getAttribute('aria-label'), img: a.querySelector('img')?.getAttribute('src') || '' });
          }
          return list;
        });
        if (!raw.length) { failed.push(slug); continue; }
        for (const r of raw) {
          const m = r.label.match(/^(.*),\s*([^,]*),\s*공연 기간:\s*([\d.]+)\s*~\s*([\d.]+)\s*$/);
          if (!m) continue;
          const title = text(m[1]).replace(/[⠀　]+/g, ' ').trim(), place = text(m[2]).replace(/^공연장\s*:\s*/, '');
          out.push({
            id: 'nol-' + (r.href.match(/products\/(\d+)/)?.[1] || title), src: 'nol',
            title, start: ymdLoose(m[3]), end: ymdLoose(m[4]),
            place, area: areaFromText(`${title} ${place}`), img: r.img, tel: '', homepage: r.href,
            summary: label, kind: kind === 'expo' ? classify(title, '', 'expo') : 'show',
          });
        }
      } catch (e) { failed.push(`${slug}(${e.message.slice(0, 40)})`); }
    }
  } finally { await browser.close(); }
  if (failed.length) console.warn('[nol] 항목을 못 찾은 장르:', failed.join(', '));
  if (!out.length) throw new Error('NOL 페이지에서 항목을 찾지 못함 (구조 변경?)');
  return out;
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

// ---------- 10. 팝플리 (팝업스토어) ----------
async function popply() {
  const H = { headers: { 'User-Agent': UA, Referer: 'https://popply.co.kr/popup', Origin: 'https://popply.co.kr', Accept: 'application/json' } };
  const [storeBody, catBody] = await Promise.all([get('https://api.popply.co.kr/api/store/?', H), get('https://api.popply.co.kr/api/common/category', H).catch(() => '{}')]);
  let json; try { json = JSON.parse(storeBody); } catch { throw new Error('팝플리 응답 해석 실패: ' + storeBody.slice(0, 80)); }
  const list = Array.isArray(json?.data) ? json.data : [];
  if (!list.length) throw new Error('팝플리 목록이 비어 있음 (구조 변경?)');
  const cats = new Map();
  try { for (const c of JSON.parse(catBody).data || []) cats.set(c.categoryId, c.name); } catch {}
  return list.filter(o => o.title && o.startDate && !o.isDelete).map(o => {
    const cat = cats.get(o.categoryId) || '';
    const tags = (o.hashtag || '').split(',').map(t => t.trim()).filter(Boolean).slice(0, 5).map(t => '#' + t).join(' ');
    const place = [o.address, o.detailAddress].filter(Boolean).join(' ');
    return {
      id: 'popply-' + o.storeId, src: 'popply',
      title: text(o.title), start: digits(o.startDate), end: digits(o.endDate),
      place, area: areaFromText(`${o.topLevelAddress} ${o.address}`),
      img: o.thumbnails || '', tel: '', lat: o.latitude ? String(o.latitude) : '', lng: o.longitude ? String(o.longitude) : '',
      homepage: `https://popply.co.kr/popup/${o.storeId}`,
      summary: [cat, o.mainBrand && o.mainBrand !== o.title ? o.mainBrand : '', tags].filter(Boolean).join(' · '),
      kind: 'popup',
    };
  });
}

// ---------- 합치기 ----------
// 출처가 달라도 같은 행사면 하나로: 제목에서 연도·회차·판매 꼬리말을 뺀 뒤 기간이 겹치면 같은 행사로 본다
function normTitle(t) {
  return (t || '')
    .replace(/［[^］]*］|\[[^\]]*\]|\([^)]*\)|《[^》]*》|〈[^〉]*〉/g, ' ')
    .replace(/20\d\d년?|제?\s*\d+\s*(회|주년|차|위|일권)|시즌\s*\d+|얼리버드|단독판매|티켓|입장권|굿즈|전용|상품|특별패키지|패키지|할인|\d+%|\b(in|at)\b/gi, ' ')
    .replace(/[^0-9a-z가-힣\u2160-\u217f]/gi, '')
    .toLowerCase();
}
// '기획전시'처럼 장르 낱말만 남는 이름은 서로 다른 행사도 같아 보이므로 원래 제목 전체를 쓴다
const GENERIC_KEY = /^(기획전시|특별전시?|기획전|전시|공연|체험|교육|프로그램|축제|행사|강좌|클래스|뮤지컬|연극|콘서트)+$/;
const sameArea = (a, b) => !a.area || !b.area || a.area === b.area;
const richness = it => (it.summary ? 4 : 0) + (it.img ? 2 : 0) + (it.homepage ? 1 : 0) + (it.tel ? 1 : 0);
function dedupe(items) {
  const groups = new Map();
  const byId = new Map(); // 같은 출처에서 같은 id 로 두 번 나오면 (제목만 조금 다른 경우) 무조건 같은 행사
  for (const it of items) {
    let k = normTitle(it.title);
    if (k.length < 4 || GENERIC_KEY.test(k)) k = (it.title || '').replace(/\s+/g, '').toLowerCase();
    if (byId.has(it.id)) k = byId.get(it.id); else byId.set(it.id, k);
    // '봉주르 장자크 상페' 와 '봉주르 장자크 상페 세상을 그린 시선' 처럼 한쪽이 다른 쪽의 앞부분이면 같은 행사로 본다
    if (k.length >= 8) for (const key of groups.keys()) if (key.length >= 8 && (key.startsWith(k) || k.startsWith(key))) { k = key; break; }
    if (!groups.has(k)) groups.set(k, []);
    const g = groups.get(k);
    // 같은 이름이라도 지역이 다르면 (전국 투어의 도시별 공연) 다른 항목
    const hit = g.find(o => o.id === it.id) || g.find(o => sameArea(o, it) && (it.start || '0') <= (o.end || '9') && (o.start || '0') <= (it.end || '9'));
    if (!hit) { g.push({ ...it }); continue; }
    // 정보가 더 많은 쪽을 기준으로 하고 빈 칸은 다른 쪽에서 채운다. 기간은 둘을 합친다.
    const [base, other] = richness(it) > richness(hit) ? [it, hit] : [hit, it];
    Object.assign(hit, { ...base,
      img: base.img || other.img, homepage: base.homepage || other.homepage, summary: base.summary || other.summary, tel: base.tel || other.tel,
      price: base.price || other.price,
      place: base.place || other.place, area: base.area || other.area, lat: base.lat || other.lat, lng: base.lng || other.lng,
      start: [base.start, other.start].filter(Boolean).sort()[0], end: [base.end, other.end].filter(Boolean).sort().pop(),
    });
  }
  return mergeSameEvent([...groups.values()].flat());
}

// 출처마다 제목 쓰는 법이 달라 생기는 중복을 한 번 더 합친다.
//   '브람스' (NOL) = '[서울] 뮤지컬 브람스' (문화정보원)
//   '《마틴 파 : We Are Martin Parr》' = '[서울시립 사진미술관] 마틴 파 : We Are Martin Parr'
// 핵심 이름은 꺾쇠 안의 이름을 살리고, 앞머리 꼬리표·장르 낱말·연도·회차를 뗀 것이다.
const CORE_DROP = /뮤지컬|연극|음악극|콘서트|전시회?|특별전|기획전|초대전|개인전|공연|오페라|발레|창극|리사이틀|내한|단독판매|단독|앵콜|이머시브|케이팝|정기공연|전국투어|투어|기념|10주년|\d+주년/g;
function coreName(t) {
  let s = (t || '').replace(/&amp;/g, '&').replace(/,\s*\d+위$/, '');
  const inner = s.match(/[〈<《「『]([^〉>》」』]{2,})[〉>》」』]/);
  if (inner) s = '〈' + inner[1]; // 꺾쇠 안 이름이면 두 글자('지젤')도 믿을 만하므로 표시를 남긴다
  return s.replace(/［[^］]*］|\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/20\d\d(?:년|\s|$)|제?\s*\d+\s*(?:회|차|기)\b/g, ' ')
    .replace(CORE_DROP, ' ').replace(/[^0-9a-z가-힣\u2160-\u217f〈]/gi, '').toLowerCase();
}
// 본행사와 딸린 프로그램(연계 행사, 관객과의 대화, 모집 공고, 부가 서비스)은 이름이 같아도 다른 항목이다
const SIDE = /연계|관객과의|대화|모집|워크숍|워크샵|클래스|강연|특강|체험|자막|예약 서비스|팸투어|부스/;
const TITLE_AD = /단독판매|좌석우위|\d+위$|할인|얼리버드/;
const placeKey = p => (p || '').replace(/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\S*\s*/, '').replace(/[^0-9a-z가-힣]/gi, '').slice(0, 8);
function mergeSameEvent(items) {
  const byCore = new Map(), out = [];
  for (const it of items) {
    const c = coreName(it.title);
    const bare = c.replace('〈', ''); // 표시는 길이 기준에만 쓰고 비교는 이름만으로
    if (bare.length < (c.startsWith('〈') ? 2 : 3) || GENERIC_KEY.test(bare)) { out.push(it); continue; }
    const list = byCore.get(bare) || [];
    const hit = list.find(o =>
      (it.start || '0') <= (o.end || o.start || '9') && (o.start || '0') <= (it.end || it.start || '9') &&
      sameArea(it, o) &&
      SIDE.test(it.title) === SIDE.test(o.title) &&
      // 같은 출처끼리는 장소까지 같아야 (지점·회차가 다른 상품을 합치지 않도록)
      (it.src !== o.src || !it.place || !o.place || placeKey(it.place) === placeKey(o.place)));
    if (!hit) { list.push(it); byCore.set(bare, list); out.push(it); continue; }
    const [base, other] = richness(it) > richness(hit) ? [it, hit] : [hit, it];
    const also = [...new Set([...(hit.also || []), ...(it.also || []), base.src === other.src ? null : other.src].filter(Boolean))];
    Object.assign(hit, { ...base,
      // 제목은 꼬리표·순위가 덜 붙은 쪽 (NOL 의 '단독판매', ', 2위' 따위)
      // 제목은 딸린 프로그램·광고 문구가 없는 쪽, 그다음 정보가 많은(긴) 쪽
      title: [base.title, other.title].sort((a, b) => SIDE.test(a) - SIDE.test(b) || TITLE_AD.test(a) - TITLE_AD.test(b) || b.length - a.length)[0],
      img: base.img || other.img, homepage: base.homepage || other.homepage, summary: base.summary || other.summary, tel: base.tel || other.tel,
      price: base.price || other.price, famous: base.famous || other.famous,
      place: base.place || other.place, area: base.area || other.area, lat: base.lat || other.lat, lng: base.lng || other.lng,
      start: [base.start, other.start].filter(Boolean).sort()[0], end: [base.end, other.end].filter(Boolean).sort().pop(),
      ...(also.length ? { also } : {}),
    });
  }
  return out;
}

async function main() {
  try { PREV = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
  const all = { tour: tourApi, ci: cultureInfo, coex, kintex, bexco, visitseoul, melon, nol, kopis, popply, sports, lck, marathon, themepark,
    seoul, gyeonggi, famousfest, market5, booktalk, filmfest, fleamarket,
    frip, sssd, welchon, knps, foresttrip, templestay };
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

  // 문체부 지정 문화관광축제는 출처와 상관없이 famous 칸에 등급을 남긴다 (대표 축제 표시·정렬용)
  // (공연·5일장처럼 이름만 겹치는 항목은 빼고, 축제처럼 보이는 제목에만)
  for (const it of items) {
    if (it.src === 'market5' || it.kind === 'show' || !/축제|페스티벌|페스타|festival|문화제|축전|대제전|한마당|박람회/i.test(it.title)) continue;
    const f = famousMatch(it.title); if (f) it.famous = f.grade || '문화관광축제';
  }

  // AI 분류 결과(classify.mjs 가 붙이는 ai 칸)는 제목이 같으면 이어받는다 — 새 행사만 다시 분류하면 된다
  const prevAi = new Map((prev?.items || []).filter(p => p.ai).map(p => [p.id, p]));
  for (const it of items) { const p = prevAi.get(it.id); if (p && p.title === it.title) it.ai = p.ai; }

  const failedAll = results.every(r => r.status === 'rejected' && !r.reason.skipped);
  if (failedAll) { console.error('모든 출처 실패, 파일을 갱신하지 않습니다.'); process.exit(1); }

  await mkdir(dirname(OUT.pathname), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sources: report,
    aiClassified: prev?.aiClassified,
    items,
  }, null, 0) + '\n');
  console.log(`events.json 저장: ${items.length}건`, report);
}

main().catch(e => { console.error(e); process.exit(1); });
