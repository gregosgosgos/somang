// 솜씨당 — 원데이 공예·요리 클래스. 웹앱이 쓰는 API(/m/api/ssdc/ios_server/v9)는 요청·응답 본문을
// 고정 키 AES-128-CBC(base64)로 감싼다 (키/IV 는 공개 JS 번들에 그대로 있음). 로그인 불필요.
import crypto from 'node:crypto';
import { get, clip, TODAY, HORIZON, ymd } from '../lib.mjs';

const API = 'https://www.sssd.co.kr/m/api/ssdc/ios_server/v9';
const KEY = Buffer.from('sssdckeyprivatee'), IV = Buffer.from('drowssapdrowssap');
const enc = s => { const c = crypto.createCipheriv('aes-128-cbc', KEY, IV); return Buffer.concat([c.update(s, 'utf8'), c.final()]).toString('base64'); };
const dec = s => { const d = crypto.createDecipheriv('aes-128-cbc', KEY, IV); return Buffer.concat([d.update(Buffer.from(s.replace(/[\r\n]/g, '').replace(/ /g, '+'), 'base64')), d.final()]).toString('utf8'); };
async function call(type, data) {
  const body = enc(JSON.stringify({ type, data, languageCode: 'ko' }));
  const res = JSON.parse(dec(await get(API, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.sssd.co.kr/m/home' }, body })));
  if (res.data?.result !== 's') throw new Error(`sssd ${type}: result=${res.data?.result}`);
  return res.data;
}

// 시·도 코드(행안부) → [이름, 우리 지역 코드, 담을 개수]
const REGIONS = {
  11: ['서울', 1, 50], 41: ['경기', 31, 30], 28: ['인천', 2, 8], 26: ['부산', 6, 12], 27: ['대구', 4, 8], 30: ['대전', 3, 8],
  29: ['광주', 5, 6], 31: ['울산', 7, 4], 36: ['세종', 8, 3], 51: ['강원', 32, 5], 43: ['충북', 33, 4], 44: ['충남', 34, 5],
  45: ['전북', 37, 4], 46: ['전남', 38, 3], 47: ['경북', 35, 4], 48: ['경남', 36, 6], 50: ['제주', 39, 8],
};
const SKIP_MAIN = new Set([5, 13]); // 헬스, 모임
const BASE = { userId: null, reqType: 1 /* 인기순 */, pageCount: 1, priceType: 0, timeZone: -1, possibleMaxNumber: 0, lessonStartTime: null, lessonEndTime: null, isPremiumAuthor: false, isHideAllTimeClass: false, isEarlyBirdClass: false, isPossibleReservationClass: false, hasParking: false, isOnlyCount: false };

export async function sssd() {
  const out = [], seen = new Set(), horizon = ymd(HORIZON);
  for (const [code, [sido, area, quota]] of Object.entries(REGIONS)) {
    let n = 0;
    for (let page = 1; page <= 3 && n < quota; page++) {
      let list = [];
      try { list = (await call('ReqClassListInfoV2', { ...BASE, pageCount: page, regionInfoList: [{ ctprvnCode: code }] })).classList || []; }
      catch (e) { if (!/result=n/.test(e.message)) console.log(`[sssd] ${sido} p${page} 실패: ${e.message}`); break; } // n = 해당 지역 클래스 없음
      for (const c of list) {
        if (n >= quota) break;
        if (seen.has(c.idx) || c.isSoldOut || c.classState !== 0 || SKIP_MAIN.has(c.mainCategoryId) || String(c.ctprvnCode) !== code) continue;
        seen.add(c.idx); n++;
        const price = c.lowestPrice || c.price;
        out.push({
          id: `sssd-${c.idx}`, src: 'sssd', title: (c.title || '').replace(/\s+/g, ' ').trim(), start: TODAY, end: horizon,
          place: `${sido} ${c.locDesc || c.shortLocation || ''}`.trim(), area, img: c.thumbUrl || '', tel: '',
          homepage: `https://www.sssd.co.kr/m/class/detail/${c.idx}`,
          summary: clip(`${c.categoryName || '클래스'} 원데이클래스${c.replyCount ? ` · 후기 ${c.replyCount}개` : ''}${c.satisfaction ? ` · 만족도 ${c.satisfaction}%` : ''} · 일정 선택 예약`),
          price: price ? `${Number(price).toLocaleString('ko-KR')}원~` : '', kind: 'edu',
        });
      }
      if (list.length < 30) break;
      await new Promise(r => setTimeout(r, 300));
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return out.slice(0, 150);
}
