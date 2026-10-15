// 플리마켓·야시장·장터 (kind 'fest')
// 마르쉐(marcheat.net)는 해외 IP 를 '접근 제한'(403)으로 막고(브라우저도 동일), 서울밤도깨비야시장은 공식 일정 페이지가 없어 제외.
// 대신 공개 목록 두 곳에서 마켓류만 골라낸다:
//  - 문체부 연도별 지역축제 개최계획(xlsx): 야시장·마켓·장터 행사. 날짜 없이 '10월'만 적힌 행은 그 달 전체로 넣고 요약에 표시.
//  - 문체부 축제 목록 페이지(대한민국 구석구석 연동, 포스터 포함)
// 서울문화포털(seoul)·지지씨(gyeonggi)에도 마켓 행사가 일부 있으니 거기서 중복될 수 있다.
import { get, areaFromText, clip, text, TODAY, HORIZON, ymd, today } from '../lib.mjs';
import { yearPlan, norm } from './famousfest.mjs';

const MCST = 'https://www.mcst.go.kr';
const RE = /야시장|플리\s*마켓|프리\s*마켓|벼룩|나이트\s*마켓|아트\s*마켓|크리스마스\s*마켓|마켓|장터|직거래|농부시장|파머스/i;
const NOT = /장터국밥|금영화|박람회/;
const pad = n => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(y, m, 0).getDate();

export async function fleamarket() {
  const horizon = ymd(HORIZON), y = today.getFullYear();
  const out = new Map();
  const add = it => {
    if (!it.start || it.end < TODAY || it.start > horizon) return;
    const k = norm(it.title).replace(/^제?\d+회/, '') + it.start.slice(0, 6);
    if (!out.has(k) || (!out.get(k).img && it.img)) out.set(k, it);
  };
  for (const year of [y, y + 1]) {
    let rows = [];
    try { rows = await yearPlan(year); } catch (e) { console.log(`[fleamarket] ${year} 개최계획: ${e.message.slice(0, 60)}`); continue; }
    for (const r of rows) {
      if (!RE.test(r.title) || NOT.test(r.title)) continue;
      let { start, end } = r, note = '';
      const [sy, sm, sd, ey, em, ed] = r.raw;
      if (!start && sy && sm) {        // '월 중' 행
        start = `${sy}${pad(sm)}${pad(sd || 1)}`;
        const Y = ey || sy, M = em || sm;
        end = `${Y}${pad(M)}${pad(ed || lastDay(Y, M))}`;
        note = `${sm}월 중(세부 날짜 미정) · `;
      }
      if (!start) continue;
      add({
        id: `fleamarket-mcst-${norm(r.title)}-${start.slice(0, 6)}`, src: 'fleamarket', title: r.title, start, end: end || start,
        place: r.place, area: areaFromText(`${r.addr} ${r.region}`), img: '', tel: '',
        homepage: `${MCST}/site/s_culture/festival/festivalList.jsp`,
        summary: clip(`${note}${r.addr}${r.place ? ' · ' + r.place : ''}${r.tel ? ' · 문의 ' + r.tel : ''}`), price: '', kind: 'fest',
      });
    }
  }
  // 문체부 축제 목록 (진행·예정)
  try {
    for (let p = 1; p <= 40; p++) {
      const h = await get(`${MCST}/site/s_culture/festival/festivalList.jsp?pCurrentPage=${p}`);
      const lis = h.split(/<li>\s*<a href="festivalView\.jsp\?pSeq=/).slice(1);
      for (const li of lis) {
        const seq = li.match(/^(\d+)/)?.[1];
        const title = text(li.match(/class="sub-tit">([\s\S]*?)<\/p>/)?.[1]);
        if (!RE.test(title) || NOT.test(title)) continue;
        const per = text(li.match(/<strong>기간<\/strong>:([^<]*)/)?.[1]).split('|');
        const m = per[0].match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.(?:\s*~\s*(?:(\d{4})\.\s*)?(\d{1,2})\.\s*(\d{1,2})\.)?/);
        if (!m) continue;
        const start = `${m[1]}${pad(m[2])}${pad(m[3])}`;
        let end = m[5] ? `${m[4] || m[1]}${pad(m[5])}${pad(m[6])}` : start;
        if (end < start) end = `${+m[1] + 1}${end.slice(4)}`;
        const place = text(li.match(/<strong>장소<\/strong>:([^<]*)/)?.[1]);
        const img = li.match(/<img src="([^"]+)"/)?.[1];
        add({
          id: `fleamarket-mcst-${seq}`, src: 'fleamarket', title, start, end, place, area: areaFromText(place),
          img: img ? new URL(img, MCST).href : '', tel: '', homepage: `${MCST}/site/s_culture/festival/festivalView.jsp?pSeq=${seq}`,
          summary: clip(`${(per[1] || '').trim() ? per[1].trim() + ' · ' : ''}${text(li.match(/class="sub-text">([\s\S]*?)<\/div>/)?.[1])}`), price: '', kind: 'fest',
        });
      }
      if (!lis.length || !h.includes(`pCurrentPage=${p + 1}`)) break;
    }
  } catch (e) { console.log(`[fleamarket] 축제 목록: ${e.message.slice(0, 80)}`); }
  return [...out.values()];
}
