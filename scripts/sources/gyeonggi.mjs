// 경기도 문화행사 — 경기문화재단 '지지씨(ggc.ggcf.kr)' 공개 JSON API (인증키 없이 동작, 해외 IP 허용).
// openapi.gg.go.kr(경기데이터드림)은 해외 IP에 '보안 정책에 의해 차단' 페이지를 돌려줘 쓸 수 없다.
// 목록은 등록일 역순이라, 한 페이지 전체가 이미 끝난 행사뿐이면 멈춘다.
import { get, clip, text, classify, TODAY, HORIZON, ymd } from '../lib.mjs';

const API = 'https://ggc.ggcf.kr/open/json/playongoing';
const KIND = { '전시': 'expo', '공연': 'show', '교육': 'edu' };
const d8 = s => (s || '').replace(/\D/g, '').slice(0, 8);
const clean = s => { const t = text(s); return t === 'undefined' || t === 'null' ? '' : t; };

export async function gyeonggi() {
  const horizon = ymd(HORIZON);
  const out = new Map();
  for (let page = 0, stale = 0; page < 30 && stale < 2; page++) {
    const d = JSON.parse(await get(`${API}?page=${page}&perpage=100`));
    const rows = d.DATA || [];
    if (!rows.length) break;
    let live = 0;
    for (const r of rows) {
      const start = d8(r.startdate), end = d8(r['enddate:'] || r.enddate) || start;
      if (!start || end < TODAY || start > horizon) continue;
      live++;
      const id = (r.href || '').split('/').pop();
      const title = clean(r.subject);
      const org = clean(r.inarea).split(/[\/,·]/)[0].trim();
      const cost = clean(r.incost);
      const img = clean(r.thumbnail);
      out.set(id, {
        id: `gyeonggi-${id}`, src: 'gyeonggi', title, start, end,
        place: clean(r.address) || org || clean(r.writer),
        area: 31,
        img: img ? encodeURI(decodeURI(img)).replace(/^http:/, 'https:') : '',
        tel: '',
        homepage: clean(r.href),
        summary: clip([r.category, clean(r.intime), cost, clean(r.inquiry)].filter(Boolean).join(' · ')),
        price: /무료/.test(cost) ? '무료' : clip(cost, 40),
        kind: r.category === '행사' ? classify(title, '', 'fest') : (KIND[r.category] || classify(title, r.category)),
      });
    }
    stale = live ? 0 : stale + 1;
  }
  return [...out.values()];
}
