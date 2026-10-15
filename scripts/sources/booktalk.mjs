// 북토크·작가와의 만남·강연 (kind 'edu')
// - 알라딘 '작가와의 만남' 목록(www.aladin.co.kr/events/wevent_author.aspx): 카드마다 행사일시·장소가 있다. 온라인/줌 행사, 시사회·예매권 이벤트는 뺀다.
// - 국립중앙도서관 '강연·세미나'(nl.go.kr N30902000000): 목록엔 접수기간뿐이라 최근 글만 상세에 들어가 '일시' 를 읽는다.
// 예스24·교보문고는 작가 행사만 모은 목록이 없어(교보 /culture 는 유료 클래스 상품) 제외.
import { get, areaFromText, clip, text, mapPool, TODAY, HORIZON, ymd, today, addDays } from '../lib.mjs';

const pad = n => String(n).padStart(2, '0');
// 연도 없는 'M월 D일' → 오늘 기준 가장 그럴듯한 연도(두 달 넘게 지났으면 내년)
function mdToYmd(m, d) {
  let y = today.getFullYear();
  const s = `${y}${pad(m)}${pad(d)}`;
  if (s < ymd(addDays(today, -60))) y++;
  return `${y}${pad(m)}${pad(d)}`;
}
const ONLINE = /온라인|줌|zoom|유튜브|youtube|라이브 방송|화상/i;

async function aladin() {
  const base = 'https://www.aladin.co.kr';
  const h = await get(`${base}/events/wevent_author.aspx`);
  const out = [];
  for (const td of h.split(/<td>\s*<a href="\/events\/wevent\.aspx\?EventId=/).slice(1)) {
    const id = td.match(/^(\d+)/)?.[1];
    const title = text(td.match(/<h3 class="tt2">([\s\S]*?)<\/h3>/)?.[1]);
    const when = text(td.match(/<strong>행사일시<\/strong>\s*:\s*([^<]*)/)?.[1]);
    const place = text(td.match(/<strong>행사장소<\/strong>\s*:\s*([^<]*)/)?.[1]);
    const m = when.match(/(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일/);
    if (!id || !m || !place || ONLINE.test(place) || /시사회|예매권/.test(title)) continue;
    const start = m[1] ? `${m[1]}${pad(m[2])}${pad(m[3])}` : mdToYmd(+m[2], +m[3]);
    const img = (td.match(/<img src="([^"]+)"/)?.[1] || '').trim().replace(/^http:/, 'https:');
    const apply = text(td.match(/<strong>신청기간<\/strong>\s*:\s*([^<]*)/)?.[1]);
    out.push({
      id: `booktalk-aladin-${id}`, src: 'booktalk', title, start, end: start,
      place: /알라딘빌딩/.test(place) ? `${place}(서울 마포구)` : place,
      area: areaFromText(place) || (/알라딘빌딩/.test(place) ? 1 : 0),
      img, tel: '', homepage: `${base}/events/wevent.aspx?EventId=${id}`,
      summary: clip(`알라딘 작가와의 만남 · ${when} · ${place}${apply ? ' · 신청 ' + apply : ''}`), price: '', kind: 'edu',
    });
  }
  return out;
}

async function nlgo() {
  const base = 'https://www.nl.go.kr/NL/contents/N30902000000.do';
  const h = await get(base);
  const rows = [];
  for (const li of h.split('class="ucreq3_item"').slice(1)) {
    const id = li.match(/fn_goView\('(\d+)'\)/)?.[1];
    const title = text(li.match(/<strong>([\s\S]*?)<\/strong>/)?.[1]);
    const rec = (li.match(/(\d{4}\.\d{2}\.\d{2})\s*~\s*(\d{4}\.\d{2}\.\d{2})/) || []).map(s => s.replace(/\D/g, ''));
    if (id && title && rec[2] && rec[2] >= ymd(addDays(today, -30)) && !/워크숍|참여기관|담당자/.test(title)) rows.push({ id, title, recEnd: rec[2] });
  }
  const out = [];
  await mapPool(rows, 3, async r => {
    const d = await get(`${base}?schM=view&schId=${r.id}`);
    const body = text(d.replace(/<br\s*\/?>/gi, ' '));
    const place = text(d.match(/info_title">장소<\/span>\s*<span[^>]*>([^<]*)/)?.[1]) || '국립중앙도서관';
    const m = body.match(/일\s*시[^0-9]{0,15}(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?(?:[^~]{0,20}~\s*(?:(\d{4})\.\s*)?(\d{1,2})\.\s*(\d{1,2})\.)?/);
    if (!m) return;
    const start = `${m[1]}${pad(m[2])}${pad(m[3])}`;
    const end = m[6] ? `${m[4] || m[1]}${pad(m[5])}${pad(m[6])}` : start;
    const desc = body.match(/일\s*시[\s\S]{0,120}/)?.[0] || '';
    out.push({
      id: `booktalk-nl-${r.id}`, src: 'booktalk', title: r.title, start, end: end < start ? start : end,
      place, area: 1, img: '', tel: '', homepage: `${base}?schM=view&schId=${r.id}`,
      summary: clip(`국립중앙도서관 · ${desc}`), price: '무료', kind: 'edu',
    });
  }, 'booktalk-nl');
  return out;
}

export async function booktalk() {
  const horizon = ymd(HORIZON);
  const all = [];
  for (const [name, fn] of [['aladin', aladin], ['nl', nlgo]]) {
    try { all.push(...await fn()); } catch (e) { console.log(`[booktalk] ${name} 실패: ${e.message.slice(0, 100)}`); }
  }
  const seen = new Set();
  return all.filter(x => x.end >= TODAY && x.start <= horizon && !seen.has(x.id) && seen.add(x.id));
}
