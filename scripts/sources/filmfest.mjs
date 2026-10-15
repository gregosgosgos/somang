// 국내 영화제 (kind 'fest')
// - KOBIZ(영화진흥위원회) 국제영화제 목록 중 개최국 '한국'(natCd=22041011) 영화제: 명칭·개최시기·도시, 상세에 홈페이지.
// - 보조: 문체부 연도별 지역축제 개최계획(xlsx)의 '영화제/영화축제' 행 (KOBIZ 에 없는 지역 영화제).
import { get, areaFromText, clip, text, mapPool, TODAY, HORIZON, ymd, today } from '../lib.mjs';
import { yearPlan, norm } from './famousfest.mjs';

const K = 'https://www.kobiz.or.kr/new/kor/02_overseas/festival';
// KOBIZ 의 개최도시 → 시·도
const CITY = { 고양: 31, 부천: 31, 안산: 31, 수원: 31, 성남: 31, 파주: 31, 의정부: 31, 평창: 32, 강릉: 32, 춘천: 32, 원주: 32, 정동진: 32, 제천: 33, 청주: 33, 충주: 33, 전주: 37, 무주: 37, 합천: 36, 창원: 36, 진주: 36, 통영: 36, 김해: 36, 거제: 36, 포항: 35, 경주: 35, 안동: 35, 여수: 38, 순천: 38, 목포: 38, 제주: 39, 서귀포: 39, 울주: 7 };

async function kobiz() {
  const rows = [];
  for (let p = 1; p <= 10; p++) {
    const h = await get(`${K}/festivalList.jsp?pageIndex=${p}`, {
      method: 'POST', body: new URLSearchParams({ conCd: '220310', natCd: '22041011', gubun: 'FESTIVAL', month: 'ALL', mode: 'FESTIVAL_LIST' }),
      headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const trs = h.split('<tr>').slice(1).filter(r => r.includes('goView("FESTIVAL"'));
    if (!trs.length) break;
    for (const r of trs) {
      const td = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => text(m[1]));
      const [cd, seq] = r.match(/goView\("FESTIVAL","(\d+)","(\d+)"\)/).slice(1);
      const d = (td[1] || '').match(/(\d{4})\.(\d{2})\.(\d{2})\s*~\s*(\d{4})\.(\d{2})\.(\d{2})/);
      if (!d) continue;
      rows.push({ cd, seq, title: td[0], genre: td[2], city: td[4], start: d.slice(1, 4).join(''), end: d.slice(4, 7).join('') });
    }
  }
  const horizon = ymd(HORIZON);
  const live = rows.filter(r => r.end >= TODAY && r.start <= horizon);
  await mapPool(live, 3, async r => {
    const h = await get(`${K}/festivalView.jsp?type=FESTIVAL&cd=${r.cd}&seq=${r.seq}`);
    const t = h.replace(/<[^>]+>/g, '\n').split('\n').map(s => text(s)).filter(Boolean);
    const i = t.indexOf('홈페이지');
    if (i >= 0 && /^https?:\/\//.test(t[i + 1])) r.homepage = t[i + 1];
  }, 'filmfest-kobiz');
  return live.map(r => ({
    id: `filmfest-kobiz-${r.cd}-${r.start.slice(0, 4)}`, src: 'filmfest', title: r.title, start: r.start, end: r.end,
    place: r.city || '', area: CITY[r.city] || areaFromText(`${r.city} ${r.title}`),
    img: '', tel: '', homepage: r.homepage || `${K}/festivalView.jsp?type=FESTIVAL&cd=${r.cd}&seq=${r.seq}`,
    summary: clip(`영화제 · ${[r.genre, r.city].filter(Boolean).join(' · ')} · ${r.start.slice(4, 6)}.${r.start.slice(6)}~${r.end.slice(4, 6)}.${r.end.slice(6)}`), price: '', kind: 'fest',
  }));
}

async function mcstFilm() {
  const y = today.getFullYear(), out = [];
  for (const year of [y, y + 1]) {
    let rows = [];
    try { rows = await yearPlan(year); } catch { continue; }
    for (const r of rows) {
      if (!/영화제|영화축제|필름|film|시네마/i.test(r.title) || /연계|금영화/.test(r.title) || !r.start) continue;
      out.push({
        id: `filmfest-mcst-${norm(r.title).replace(/^제?\d+회/, '')}-${r.start.slice(0, 4)}`, src: 'filmfest', title: r.title,
        start: r.start, end: r.end || r.start, place: r.place, area: areaFromText(`${r.addr} ${r.region}`),
        img: '', tel: '', homepage: 'https://www.mcst.go.kr/site/s_culture/festival/festivalList.jsp',
        summary: clip(`${r.addr} · ${r.place}${r.tel ? ' · 문의 ' + r.tel : ''}`), price: '', kind: 'fest',
      });
    }
  }
  return out;
}

export async function filmfest() {
  const horizon = ymd(HORIZON);
  const all = [];
  for (const [n, fn] of [['kobiz', kobiz], ['mcst', mcstFilm]]) {
    try { all.push(...await fn()); } catch (e) { console.log(`[filmfest] ${n} 실패: ${e.message.slice(0, 100)}`); }
  }
  // 같은 영화제 중복 제거 (이름 핵심부 + 연도)
  const key = x => norm(x.title).replace(/^제?\d+회/, '').replace(/국제|영화제|영화축제|페스티벌/g, '') + x.start.slice(0, 4);
  const seen = new Set();
  return all.filter(x => x.end >= TODAY && x.start <= horizon && !seen.has(key(x)) && seen.add(key(x)));
}
