// 국립공원 탐방프로그램(해설·생태관광, 건강나누리, 반려견동반) — reservation.knps.or.kr
// 목록: POST /trprogram/trprogramList.do (HTML 조각, dept_id='' 이면 전체 공원), 상세: /contents/G/serviceGuide.do
// (예약 화면은 NetFunnel 대기열을 쓰지만 목록·상세 조회는 대기열 없이 응답한다)
import { get, text, clip, areaFromText, mapPool, TODAY, HORIZON, ymd } from '../lib.mjs';

const HOST = 'https://reservation.knps.or.kr';
const GROUPS = [['G', '해설·생태관광'], ['H', '건강나누리'], ['PET', '반려견동반']];
// 세부 공원(parkId) → 지역 코드 (집결장소에 주소가 없을 때). 지리산·한려·팔공 등은 사무소별로 시·도가 다르다
const PARK_AREA = {
  B131: 36, B133: 35, B151: 35, B161: 34, B163: 34, B042: 37, B041: 38, B331: 37, B091: 38, B092: 38, B051: 37,
  B171: 5, B172: 38, B231: 5, B181: 37, B183: 37, B141: 1, B142: 1, B971: 1, B031: 32, B301: 32, B121: 35, B122: 33,
  B123: 35, B191: 33, B991: 38, B061: 32, B111: 33, B201: 38, B071: 35, B011: 36, B014001: 36, B013: 38, B012: 37,
  B101: 32, B221: 32, B081: 34, B251: 35, B252: 4, B022: 36, B021: 36, B024: 36, B981: 34,
};
const parkArea = url => PARK_AREA[url.match(/parkId=(B\d+)/)?.[1]] || 0;
const CAP = 150;

const post = body => get(`${HOST}/trprogram/trprogramList.do`, {
  method: 'POST', body: new URLSearchParams(body),
  headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Referer: `${HOST}/trprogram/searchTrailProgram.do` },
});

export async function knps() {
  const rows = new Map();
  for (const [gbn, gname] of GROUPS) {
    for (let page = 1; page <= 8; page++) {
      let html;
      try { html = await post({ dept_id: '', dept_name: '전체', orgnzt_gbn: gbn, pageNo: page, listScale: 30 }); }
      catch (e) { console.log(`[knps] ${gname} p${page} 실패: ${e.message}`); break; }
      const trs = html.split('<tr>').slice(1).filter(t => /serviceGuide\.do/.test(t));
      for (const tr of trs) {
        const td = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => text(m[1]));
        const href = tr.match(/href="(\/contents\/[^"]*serviceGuide\.do[^"]*)"/)[1].replace(/&amp;/g, '&');
        const prd = href.match(/prdId=([^&]+)/)?.[1];
        const per = (td[4] || '').match(/(\d{4})-(\d\d)-(\d\d)\s*~\s*(\d{4})-(\d\d)-(\d\d)/);
        if (!prd || rows.has(prd) || !per) continue;
        rows.set(prd, { prd, gname, park: td[1], meet: td[2], title: td[3], s: per.slice(1, 4).join(''), e: per.slice(4, 7).join(''), url: HOST + href });
      }
      if (trs.length < 30) break;
    }
  }
  const horizon = ymd(HORIZON);
  const list = [...rows.values()].filter(r => r.e >= TODAY && r.s <= horizon).slice(0, CAP);
  const items = list.map(r => ({
    id: `knps-${r.prd}`, src: 'knps', title: r.title.replace(/^\[\d+년\]\s*/, '').replace(/^★\s*/, '').trim(),
    start: r.s > TODAY ? r.s : TODAY, end: r.e, place: `${r.park}국립공원 ${r.meet}`.trim(), area: parkArea(r.url),
    img: '', tel: '', homepage: r.url, summary: `국립공원 탐방프로그램(${r.gname})`, price: '', kind: 'edu', _r: r,
  }));
  await mapPool(items, 3, async it => {
    const h = await get(it.homepage);
    const f = {};
    for (const m of h.matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)) f[text(m[1])] = text(m[2].replace(/<br\s*\/?>/gi, ' / '));
    const img = h.match(/<img src="(\/cntnts\/[^"]+)"/)?.[1];
    if (img) it.img = HOST + img;
    const meet = f['집결장소'] || '';
    const addr = meet.match(/\(([^()]*(?:시|군|구|도)\s[^()]*)\)/)?.[1];
    if (meet) it.place = `${it._r.park}국립공원 ${meet}`;
    it.area = areaFromText(addr || '') || it.area || areaFromText(meet);
    it.tel = (f['문의전화'] || '').match(/0\d{1,2}-\d{3,4}-\d{4}/)?.[0] || '';
    const sched = (f['소요시간'] || '').replace(/\s*\/\s*/g, ' · ');
    const fee = Object.entries(f).find(([k]) => /참가비|요금|비용/.test(k))?.[1] || '';
    if (fee) it.price = clip(fee, 40);
    it.summary = clip(`탐방프로그램(${it._r.gname}) · ${sched ? sched + ' · ' : ''}${f['주요내용'] || f['참가대상'] || ''}`);
  }, 'knps');
  return items.map(({ _r, ...it }) => it);
}
