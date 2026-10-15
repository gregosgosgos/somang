// 전통시장 5일장 — 전국전통시장표준데이터(소상공인시장진흥공단, data.go.kr 15012894)
// 1) DATA_GO_KR_KEY 가 있고 이 API(tn_pubr_public_trdit_mrkt_api)에 활용신청이 되어 있으면 API 사용
// 2) 아니면(미등록 키 포함) 같은 데이터의 CSV 파일을 공공데이터포털에서 키 없이 받는다.
//    파일 ID 는 연 1회 갱신 때 바뀌므로 목록 → 상세 팝업 → 다운로드 순으로 매번 찾아간다.
import { get, areaFromText, clip, text, TODAY, ymd, addDays, today } from '../lib.mjs';

const PORTAL = 'https://www.data.go.kr';
const PK = '15012894';
const CAP = 300;


// 따옴표를 지키는 간단한 CSV 파서
function parseCsv(s) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift().map(h => h.replace(/^﻿/, '').trim());
  return rows.filter(r => r.length >= head.length - 1).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

async function viaApi(key) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const qs = new URLSearchParams({ serviceKey: key, type: 'json', numOfRows: '1000', pageNo: String(page) });
    const d = JSON.parse(await get(`https://api.data.go.kr/openapi/tn_pubr_public_trdit_mrkt_api?${qs}`));
    const h = d.response?.header;
    if (h && h.resultCode !== '00') throw new Error(`${h.resultCode} ${h.resultMsg}`);
    const items = d.response?.body?.items || [];
    for (const r of items) out.push({ 시장명: r.mrktNm, 소재지도로명주소: r.rdnmadr, 소재지지번주소: r.lnmadr, 시장개설주기: r.mrktEstblCycle, 전화번호: r.phoneNumber, 취급품목: r.trtmntPrdlst, 홈페이지주소: r.homepageUrl });
    if (items.length < 1000) break;
  }
  return out;
}

async function viaFile() {
  const list = await get(`${PORTAL}/tcs/dss/stdFileList.do?publicDataPk=${PK}&pageIndex=1&searchKeyword2=`);
  const dpk = list.match(/data-public-pk="([^"]+)"/)?.[1];
  if (!dpk) throw new Error('표준데이터 파일 목록을 찾지 못함');
  const pop = await get(`${PORTAL}/tcs/dss/selectDpkDetailInfo.do`, {
    method: 'POST', body: new URLSearchParams({ publicDataDetailPk: dpk }),
    headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
  });
  const m = pop.match(/fn_fileDataDown\('\d+',\s*'[^']*',\s*'(FILE_\d+)',\s*'(\d+)'/);
  if (!m) throw new Error('다운로드 파일 ID 를 찾지 못함');
  const csv = await get(`${PORTAL}/cmm/cmm/fileDownload.do?atchFileId=${m[1]}&fileDetailSn=${m[2]}&insertDataPrcus=N`);
  return parseCsv(csv);
}

// '2일+7일', '5일장(2,7일)', '2, 7' 등 → [2, 7]
function cycleDays(s) {
  const t = s || '';
  if (/매일|상설/.test(t) && !/\d/.test(t)) return null;
  const ns = [...new Set((t.match(/\d+/g) || []).map(Number).filter(n => n >= 1 && n <= 10).map(n => n % 5 || 5))].sort((a, b) => a - b);
  if (ns.length !== 1) return null;            // 5일 주기는 끝자리 두 개(n, n+5)가 한 쌍
  const a = ns[0];
  return [a, a + 5];
}

export async function market5() {
  const key = process.env.DATA_GO_KR_KEY;
  let rows = [];
  if (key) {
    try { rows = await viaApi(key); } catch (e) { console.log(`[market5] API 실패(${e.message.slice(0, 80)}) → CSV 파일로 대체`); }
  }
  if (!rows.length) rows = await viaFile();

  const start = TODAY, end = ymd(addDays(today, 60));
  const byArea = new Map(), seen = new Set();
  for (const r of rows) {
    const days = cycleDays(r.시장개설주기);
    if (!days) continue;
    const name = text(r.시장명);
    const addr = text(r.소재지도로명주소 || r.소재지지번주소);
    if (!name || !addr) continue;
    const id = `${name}-${addr}`.replace(/\s+/g, '');
    if (seen.has(id)) continue; seen.add(id);
    const area = areaFromText(addr);
    const title = /5일장|오일장/.test(name) ? name : `${name} 5일장`;
    const it = {
      id: `market5-${id}`, src: 'market5', title, start, end,
      place: name, area, img: '', tel: '',
      homepage: /^https?:\/\//.test(r.홈페이지주소 || '') ? r.홈페이지주소 : `https://map.naver.com/p/search/${encodeURIComponent(name + ' ' + addr.split(' ').slice(0, 2).join(' '))}`,
      summary: clip(`장날 매월 ${days[0]}·${days[1]}일 · ${addr}`),
      price: '', kind: 'fest',
    };
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area).push(it);
  }
  // 지역별로 돌아가며 뽑아 CAP 건까지 (특정 도에 몰리지 않게)
  const out = [], queues = [...byArea.values()];
  while (out.length < CAP && queues.some(q => q.length)) for (const q of queues) if (q.length && out.length < CAP) out.push(q.shift());
  return out;
}
