// 문화체육관광부 지정 문화관광축제 — 유명 축제 표시용.
// - FAMOUS_FESTIVALS: '2026~2027 문화관광축제' 27개(문체부 보도자료 2026.1.23) + 명예 문화관광축제 20개(2024~2025 목록 기준,
//   2026~2027 명예축제 명단은 원문 미공개라 직전 목록 사용. 담양대나무축제 재지정 보도 확인).
//   이름이 바뀌어도 잡히도록 key(정규화한 이름에 포함되는 핵심어)로 맞춘다.
// - famousfest(): 문체부 '연도별 지역축제 개최계획'(mcst.go.kr, 올해·내년 zip 안의 xlsx)과 축제 목록 페이지에서
//   위 축제들의 날짜·장소를 찾아 item 으로 돌려준다. 날짜가 없거나 기간 밖이면 빠진다.
import { inflateRawSync } from 'node:zlib';
import { get, UA, areaFromText, clip, text, TODAY, HORIZON, ymd, today } from '../lib.mjs';

const G = '문화관광축제', H = '명예 문화관광축제';
export const FAMOUS_FESTIVALS = [
  ['강릉커피축제', '강릉커피', G], ['고령대가야축제', '대가야', G], ['광안리어방축제', '어방축제', G], ['광주김치축제', '광주김치', G],
  ['논산딸기축제', '논산딸기', G], ['동래읍성역사축제', '동래읍성', G], ['대구치맥페스티벌', '치맥', G], ['밀양아리랑대축제', '밀양아리랑', G],
  ['보성다향대축제', '다향', G], ['부천국제만화축제', '부천국제만화', G], ['부평풍물대축제', '부평풍물', G], ['부산국제록페스티벌', '부산국제록', G],
  ['수원화성문화제', '수원화성문화제', G], ['순창장류축제', '장류축제', G], ['시흥갯골축제', '갯골', G], ['세종한글축제', '세종한글', G],
  ['안성맞춤 남사당바우덕이축제', '바우덕이', G], ['연천구석기축제', '구석기', G], ['영암왕인문화축제', '왕인문화', G], ['울산옹기축제', '옹기축제', G],
  ['음성품바축제', '품바', G], ['인천펜타포트음악축제', '펜타포트', G], ['정선아리랑제', '정선아리랑', G], ['철원 한탄강 얼음트레킹', '한탄강얼음', G],
  ['청송사과축제', '청송사과', G], ['평창송어축제', '송어축제', G], ['화성뱃놀이축제', '뱃놀이', G],
  ['추억의 충장축제', '충장축제', H], ['화천산천어축제', '산천어', H], ['평창효석문화제', '효석문화제', H], ['춘천마임축제', '마임축제', H],
  ['영동난계국악축제', '난계국악', H], ['보령머드축제', '머드축제', H], ['천안흥타령축제', '흥타령', H], ['금산인삼축제', '금산인삼', H],
  ['김제지평선축제', '지평선축제', H], ['무주반딧불축제', '반딧불축제', H], ['진도신비의바닷길축제', '신비의바닷길', H], ['함평나비축제', '함평나비', H],
  ['담양대나무축제', '대나무축제', H], ['안동국제탈춤페스티벌', '탈춤', H], ['문경찻사발축제', '찻사발', H], ['영주풍기인삼축제', '풍기인삼', H],
  ['진주남강유등축제', '유등축제', H], ['하동야생차문화축제', '야생차', H], ['산청한방약초축제', '한방약초', H], ['통영한산대첩축제', '한산대첩', H],
].map(([name, key, grade]) => ({ name, key, grade }));

export const norm = s => (s || '').replace(/제\s*\d+\s*회|\d{4}\s*년?|[\s·\-_()\[\]「」『』'"’‘“”,.]/g, '');
export const famousMatch = title => { const n = norm(title); return FAMOUS_FESTIVALS.find(f => n.includes(f.key)) || null; };

// ── 최소 zip 리더 (중앙 디렉터리 → stored/deflate) ──
function unzip(buf) {
  const files = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('zip 아님');
  let p = buf.readUInt32LE(eocd + 16);
  const n = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    const data0 = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(data0, data0 + csize);
    files[name] = () => method === 0 ? raw : inflateRawSync(raw);
    p += 46 + nl + xl + cl;
  }
  return files;
}
const xmlText = s => text((s.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''));
const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
// 가장 큰 시트를 2차원 배열로
function readXlsx(buf) {
  const z = unzip(buf);
  const ss = z['xl/sharedStrings.xml'] ? (z['xl/sharedStrings.xml']().toString('utf8').match(/<si>[\s\S]*?<\/si>/g) || []).map(xmlText) : [];
  const sheet = Object.keys(z).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).map(k => z[k]().toString('utf8')).sort((a, b) => b.length - a.length)[0];
  return (sheet.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []).map(row => {
    const r = [];
    for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const ref = c.match(/ r="([A-Z]+\d+)"/)?.[1]; if (!ref) continue;
      const t = c.match(/ t="(\w+)"/)?.[1];
      const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      r[colIdx(ref)] = t === 's' ? ss[+v] : t === 'inlineStr' ? xmlText(c) : text(v || '');
    }
    return r;
  });
}

const MCST = 'https://www.mcst.go.kr';
// mcst.go.kr 다운로드는 연결이 자주 끊겨 몇 번 재시도한다. 연도별 결과는 한 실행 안에서 캐시(다른 수집기와 공유).
async function getBuf(url) {
  let err;
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) { err = e; await new Promise(r => setTimeout(r, 3000 * a)); }
  }
  throw err;
}
const planCache = new Map();
export function yearPlan(year) {
  if (!planCache.has(year)) planCache.set(year, yearPlanRaw(year).catch(e => { planCache.delete(year); throw e; }));
  return planCache.get(year);
}
// 연도별 지역축제 개최계획 xlsx → 행 객체
async function yearPlanRaw(year) {
  const f = `${year}_festival.zip`;
  const buf = await getBuf(`${MCST}/servlets/eduport/front/upload/UplDownloadFile?pFileName=${f}&pRealName=${f}&pPath=PORTAL.DOCUMENT.UPLOAD&pFlag=`);
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error(`${year} 계획 파일 없음`);
  const z = unzip(buf);
  const xl = Object.keys(z).find(k => /\.xlsx$/i.test(k) || /xlsx/i.test(k));
  const rows = readXlsx(xl ? z[xl]() : buf);
  const head = rows.findIndex(r => r.includes('축제명'));
  const H0 = rows[head] || [], H1 = rows[head + 1] || [];
  const col = name => H0.indexOf(name);
  const iName = col('축제명'), iPlace = col('개최 장소'), iDate = col('개최기간');
  const iSido = H1.indexOf('장소명') >= 0 ? iPlace + 2 : -1;
  const iTel = H1.lastIndexOf('연락처');
  const d = (y, m, dd) => (y && m && dd) ? `${y}${String(m).padStart(2, '0')}${String(dd).padStart(2, '0')}` : '';
  return rows.slice(head + 3).filter(r => r[iName]).map(r => ({
    title: text(r[iName]), place: text(r[iPlace]),
    addr: [r[iSido], r[iSido + 1], r[iSido + 2]].map(x => text(x).replace(/^\d+\.\s*/, '')).filter(x => x && x !== '-').join(' '),
    region: text(r[iName - 3]).replace(/^\d+\.\s*/, ''),
    start: d(r[iDate], r[iDate + 1], r[iDate + 2]), end: d(r[iDate + 3], r[iDate + 4], r[iDate + 5]),
    tel: text(r[iTel]),
    raw: [0, 1, 2, 3, 4, 5].map(k => +r[iDate + k] || 0),   // 시작 년·월·일, 종료 년·월·일 (일 없는 '월 중' 행 처리용)
  }));
}
// 문체부 축제 목록(대한민국 구석구석 연동) — 진행·예정 축제, 포스터와 상세 링크가 있다
async function listPages() {
  const out = [];
  for (let p = 1; p <= 40; p++) {
    const h = await get(`${MCST}/site/s_culture/festival/festivalList.jsp?pCurrentPage=${p}`);
    const lis = h.split(/<li>\s*<a href="festivalView\.jsp\?pSeq=/).slice(1);
    for (const li of lis) {
      const seq = li.match(/^(\d+)/)?.[1];
      const title = text(li.match(/class="sub-tit">([\s\S]*?)<\/p>/)?.[1]);
      const per = text(li.match(/<strong>기간<\/strong>:([^<]*)/)?.[1]).split('|')[0];
      const m = per.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.(?:\s*~\s*(?:(\d{4})\.\s*)?(\d{1,2})\.\s*(\d{1,2})\.)?/);
      if (!seq || !m) continue;
      const p2 = n => String(n).padStart(2, '0');
      const start = `${m[1]}${p2(m[2])}${p2(m[3])}`;
      const end = m[5] ? `${m[4] || m[1]}${p2(m[5])}${p2(m[6])}` : start;
      out.push({
        seq, title, start, end: end < start ? `${+m[1] + 1}${end.slice(4)}` : end,
        place: text(li.match(/<strong>장소<\/strong>:([^<]*)/)?.[1]),
        img: (li.match(/<img src="([^"]+)"/)?.[1] || ''), sub: text(li.match(/class="sub-text">([\s\S]*?)<\/div>/)?.[1]),
      });
    }
    if (!lis.length || !h.includes(`pCurrentPage=${p + 1}`)) break;
  }
  return out;
}

export async function famousfest() {
  const horizon = ymd(HORIZON), y = today.getFullYear();
  const items = new Map();
  const put = (f, it) => {
    if (!it.start || (it.end || it.start) < TODAY || it.start > horizon) return;
    const id = `famousfest-${norm(f.name)}-${it.start.slice(0, 4)}`;
    const prev = items.get(id);
    if (prev && prev.img) return;             // 포스터 있는 쪽 우선
    items.set(id, {
      id, src: 'famousfest', title: it.title || f.name, start: it.start, end: it.end || it.start,
      place: it.place || '', area: areaFromText(`${it.addr || ''} ${it.region || ''} ${it.place || ''} ${f.name}`),
      img: it.img ? new URL(it.img, MCST).href : '', tel: '', homepage: it.homepage || `${MCST}/site/s_culture/festival/festivalList.jsp`,
      summary: clip(`${f.grade} · ${f.name}${it.sub ? ' · ' + it.sub : it.addr ? ' · ' + it.addr : ''}`), price: '', kind: 'fest',
    });
  };
  for (const year of [y, y + 1]) {
    try { for (const r of await yearPlan(year)) { const f = famousMatch(r.title); if (f) put(f, r); } }
    catch (e) { console.log(`[famousfest] ${year} 개최계획: ${e.message.slice(0, 80)}`); }
  }
  try {
    for (const r of await listPages()) {
      const f = famousMatch(r.title); if (!f) continue;
      put(f, { ...r, homepage: `${MCST}/site/s_culture/festival/festivalView.jsp?pSeq=${r.seq}` });
    }
  } catch (e) { console.log(`[famousfest] 목록: ${e.message.slice(0, 80)}`); }
  return [...items.values()].sort((a, b) => a.start.localeCompare(b.start));
}
