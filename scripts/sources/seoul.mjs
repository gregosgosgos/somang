// 서울문화포털(culture.seoul.go.kr) 문화행사 — 달력용 JSON 하나로 전체 행사(약 4천 건, 과거 포함)가 내려온다.
// 공식 OpenAPI(openapi.seoul.go.kr:8088)는 해외 IP에서 연결 시간 초과라 이 경로를 쓴다.
// searchCost=0(무료) / 1(유료) 로 두 번 받아 가격 구분을 붙인다.
import { get, areaFromText, classify, clip, text, TODAY, HORIZON, ymd } from '../lib.mjs';

const BASE = 'https://culture.seoul.go.kr';
const KIND = { SHOW: 'show', EXHIBITION: 'expo', FESTIVAL: 'fest', EDUEXP: 'edu' };

async function fetchList(cost) {
  const body = new URLSearchParams({ menuNo: '200110', searchCost: cost });
  const t = await get(`${BASE}/culture/culture/cultureEvent/culturalEventCalendarList.json`, {
    method: 'POST', body,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
  });
  return JSON.parse(t).calendarList || [];
}

export async function seoul() {
  const horizon = ymd(HORIZON);
  const out = new Map();
  for (const [cost, price] of [['0', '무료'], ['1', '유료']]) {
    for (const e of await fetchList(cost)) {
      if (e.delYn === 'Y') continue;
      const start = (e.strtdate || '').replace(/\D/g, '').slice(0, 8);
      const end = (e.endDate || e.strtdate || '').replace(/\D/g, '').slice(0, 8);
      if (!start || end < TODAY || start > horizon) continue;
      const title = text(e.title);
      const place = text(e.facName);
      out.set(e.cultcode, {
        id: `seoul-${e.cultcode}`, src: 'seoul', title, start, end, place,
        area: areaFromText(e.addr) || 1,
        img: e.atchFileId ? `${BASE}/cmmn/file/getImage.do?atchFileId=${e.atchFileId}&thumb=Y` : '',
        tel: '',
        homepage: `${BASE}/culture/culture/cultureEvent/view.do?cultcode=${e.cultcode}&menuNo=200110`,
        summary: clip([e.subjcodeNm, e.addr].filter(Boolean).join(' · ') + (e.thumbDesc ? ' · ' + e.thumbDesc : '')),
        price,
        kind: KIND[e.subjcodeGroup] || (e.subjcodeNm === '영화' ? 'show' : classify(title, e.subjcodeNm, 'fest')),
      });
    }
  }
  return [...out.values()];
}
