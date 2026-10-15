// 웰촌 — 농촌체험휴양마을(딸기따기·떡만들기 등 체험 프로그램). 서버 렌더링 HTML 목록 + 마을 상세.
// 목록: /web/lay1/program/S1T11C446/travelPlaceInfo/list.do?category_code=CC01 (한 쪽 10곳)
import { get, text, clip, areaFromText, mapPool, TODAY, HORIZON, ymd, today } from '../lib.mjs';

const BASE = 'https://www.welchon.com/web/lay1/program/S1T11C446/travelPlaceInfo';
const CAP = 150;
// 시·도 코드 → 둘러볼 쪽 수 (농촌 도 단위는 2쪽, 광역시는 1쪽)
const SIDO = [['4100000000', 2], ['5100000000', 2], ['4300000000', 2], ['4400000000', 2], ['5200000000', 2], ['4600000000', 2],
  ['4700000000', 2], ['4800000000', 2], ['5000000000', 1], ['1100000000', 1], ['3100000000', 1], ['2600000000', 1], ['2700000000', 1],
  ['2800000000', 1], ['2900000000', 1], ['3000000000', 1], ['3600000000', 1]];

function parseList(html) {
  const out = [];
  for (const blk of html.split('<div class="item">').slice(1)) {
    const seq = blk.match(/view\.do\?cont_seq=(\d+)/)?.[1];
    if (!seq || !/program-wrap/.test(blk)) continue; // 체험 프로그램이 없는 마을은 건너뜀
    const img = blk.match(/<img src='([^']+)'/)?.[1] || '';
    out.push({
      seq, name: text(blk.match(/<p class="subject">([\s\S]*?)<\/p>/)?.[1]),
      addr: text(blk.match(/<p class="place">([\s\S]*?)<\/p>/)?.[1]),
      desc: text(blk.match(/<p class="text">([\s\S]*?)<\/p>/)?.[1]),
      img: img ? new URL(img, 'https://www.welchon.com').href : '',
      progs: [...blk.matchAll(/changeConts\('\d+','\w+'\)">([^<]+)</g)].map(m => text(m[1])),
    });
  }
  return out;
}

// '5월 1일 부터 6월 10일 까지' → 수집 창(오늘~6개월)과 겹치는지
const md = (m, d) => Number(m) * 100 + Number(d);
function inWindow(s, e) {
  if (s === 101 && e === 1231) return true;
  const days = [];
  for (let d = new Date(today); d <= HORIZON; d.setDate(d.getDate() + 7)) days.push(md(d.getMonth() + 1, d.getDate()));
  return days.some(x => (s <= e ? x >= s && x <= e : x >= s || x <= e));
}

export async function welchon() {
  const villages = new Map();
  const add = list => { for (const v of list) if (!villages.has(v.seq) && villages.size < CAP * 1.3) villages.set(v.seq, v); };
  // 1) 으뜸촌(우수 마을) 전국 — 약 65곳
  for (let p = 1; p <= 7; p++) {
    try { const l = parseList(await get(`${BASE}/list.do?category_code=CC01&st1=bestVil&pageindex=${p}`)); add(l); if (!l.length) break; }
    catch (e) { console.log(`[welchon] 으뜸촌 p${p} 실패: ${e.message}`); }
  }
  // 2) 시·도별 일반 마을로 지역을 고르게 채움
  for (const [sido, pages] of SIDO) for (let p = 1; p <= pages; p++) {
    try { add(parseList(await get(`${BASE}/list.do?category_code=CC01&sido=${sido}&pageindex=${p}`))); }
    catch (e) { console.log(`[welchon] ${sido} p${p} 실패: ${e.message}`); }
  }

  const horizon = ymd(HORIZON), items = [];
  await mapPool([...villages.values()], 3, async v => {
    const url = `${BASE}/view.do?cont_seq=${v.seq}&api_type=0`;
    const h = await get(url);
    const tel = text(h.match(/<th>전화<\/th>\s*<td>([\s\S]*?)<\/td>/)?.[1]).match(/[\d-]{9,}/)?.[0] || '';
    const progs = [];
    for (const b of h.split('id="lay_exp"').slice(1)) {
      const name = text(b.match(/<p class="subject">([\s\S]*?)<\/p>/)?.[1]);
      const per = b.match(/운영시기\s*:\s*(\d+)월\s*(\d+)일\s*부터\s*(\d+)월\s*(\d+)일/);
      const price = Number((b.match(/<p class="price">([^<]*)/)?.[1] || '').replace(/\D/g, '')) || 0;
      const s = per ? md(per[1], per[2]) : 101, e = per ? md(per[3], per[4]) : 1231;
      if (name && inWindow(s, e)) progs.push({ name, price, when: s === 101 && e === 1231 ? '연중' : `${per[1]}.${per[2]}~${per[3]}.${per[4]}` });
    }
    // 상세에 체험정보 표가 없으면 목록의 프로그램 이름을 그대로 쓴다
    const names = progs.length ? progs.map(p => `${p.name}(${p.when})`) : v.progs;
    if (!names.length) return;
    const prices = progs.map(p => p.price).filter(Boolean);
    items.push({
      id: `welchon-${v.seq}`, src: 'welchon', title: `${v.name} 농촌체험`, start: TODAY, end: horizon,
      place: v.addr, area: areaFromText(v.addr), img: v.img, tel, homepage: url,
      summary: clip(`농촌체험 · ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` 외 ${names.length - 4}개` : ''} · ${v.desc}`),
      price: prices.length ? `${Math.min(...prices).toLocaleString('ko-KR')}원~` : '', kind: 'edu', _order: [...villages.keys()].indexOf(v.seq),
    });
  }, 'welchon');
  return items.sort((a, b) => a._order - b._order).slice(0, CAP).map(({ _order, ...it }) => it);
}
