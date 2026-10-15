// 장소 이름·주소 → 좌표 (지도 핀용)
// 출처가 좌표를 주는 행사(관광공사·문화정보원·팝플리·전시장 등)는 그대로 쓰고, 나머지는 장소 문자열로 찾는다.
// 찾은 결과는 festivals/data/geocache.json 에 쌓아 두므로 매일 새로 생긴 장소만 찾는다. 못 찾은 장소는 한 달 뒤에 다시 시도한다.
//
//   node scripts/geocode.mjs                  # 오픈스트리트맵 기반 Photon, 초당 3건 이하, 기본 15분까지만
//   KAKAO_REST_KEY=... node scripts/geocode.mjs  # 카카오 로컬 검색이 있으면 먼저 쓴다 (빠르고 국내 장소에 강함)
//   GEOCODE_MINUTES=60 node scripts/geocode.mjs  # 한 번에 쓸 시간
//
// 결과는 각 항목의 geo = [위도, 경도], geoLv = 'src'(출처 좌표) | 'place'(장소·주소) | 'area'(시·군·구 중심)
// 시·도만 알 수 있는 항목은 지도에 찍지 않는다 (한 점에 수백 개가 겹쳐 오해를 부르므로).

import { readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../festivals/data/events.json', import.meta.url);
const CACHE = new URL('../festivals/data/geocache.json', import.meta.url);
const KAKAO = process.env.KAKAO_REST_KEY || '';
const BUDGET_MS = Number(process.env.GEOCODE_MINUTES || 15) * 60000;
const UA = 'somang-festivals/1.0 (https://github.com/gregosgosgos/somang)';
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

const inKorea = (lat, lng) => lat > 33 && lat < 38.8 && lng > 124.5 && lng < 132;
// 지역 코드 → 결과 주소에 들어 있어야 할 시·도 이름 (다른 지역의 같은 이름 장소를 거르기 위해)
const AREA_RE = {
  1: /서울/, 2: /인천/, 3: /대전/, 4: /대구/, 5: /광주/, 6: /부산/, 7: /울산/, 8: /세종/,
  31: /경기/, 32: /강원/, 33: /충청북|충북/, 34: /충청남|충남/, 35: /경상북|경북/, 36: /경상남|경남/,
  37: /전라북|전북/, 38: /전라남|전남/, 39: /제주/,
};
const SIDO = { 서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시', 광주: '광주광역시', 대전: '대전광역시', 울산: '울산광역시', 세종: '세종특별자치시', 경기: '경기도', 강원: '강원특별자치도', 충북: '충청북도', 충남: '충청남도', 전북: '전북특별자치도', 전남: '전라남도', 경북: '경상북도', 경남: '경상남도', 제주: '제주특별자치도' };

// 지도에 찍을 수 없는 장소
const NOWHERE = /^(전국|온라인|비대면|해외|미정|추후|해당 공연장|전국 각|각 지역|각 공연장)|온라인|zoom|줌\s|유튜브|라이브 ?스트리밍|해외 개최/i;

// 장소 문자열 정리: 괄호, 'N관', 층 정보, 전용관 꼬리 등을 뗀다
function clean(place) {
  return (place || '')
    .replace(/\([^)]*\)|\[[^\]]*\]|［[^］]*］/g, ' ')
    .replace(/지하\s*\d+층.*$|\d+층.*$|\s\d+관(?=\s|$)|\s[A-Z]관(?=\s|$)|전용관|전용극장|일원|일대|외\s*\d*곳?$|및\s.*$/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
const key = it => `${clean(it.place)}|${it.area || 0}`;

// 찾아볼 검색어 후보: 장소 전체 → 앞에서부터 줄인 것 → 뒤쪽 낱말(공연장 이름) → 시·군·구
// 시·도 이름만 남는 후보는 버리고, '광명시'·'부산 해운대구'처럼 행정구역뿐인 후보는 'area'(대략 위치)로 둔다.
const SIDO_RE = /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(특별시|광역시|특별자치시|특별자치도|도)?$/;
const ADMIN_RE = /^((서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|충청북도|충청남도|경상북도|경상남도|전라북도|전라남도)\S*\s+)?\S+[시군구]$/;
function candidates(it) {
  const words = clean(it.place).split(' ').filter(Boolean);
  const raw = [];
  for (let n = words.length; n >= 1; n--) raw.push(words.slice(0, n).join(' '));
  for (let n = Math.min(2, words.length - 1); n >= 1; n--) raw.push(words.slice(-n).join(' '));
  const place = [], area = [];
  for (const q of [...new Set(raw)]) {
    if (q.length < 2 || SIDO_RE.test(q)) continue;
    (ADMIN_RE.test(q) ? area : place).push(q);
  }
  // 주소가 '부산 해운대구 …' 꼴이면 시·군·구 중심이라도 마지막에
  const m = words.join(' ').match(/^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\S*\s+(\S+[시군구])/);
  if (m) area.push(`${SIDO[m[1]] || m[1]} ${m[2]}`);
  return [...place.map(q => [q, 'place']), ...[...new Set(area)].map(q => [q, 'area'])];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastCall = 0;
// Photon (komoot, 오픈스트리트맵 기반, 키 불필요). 공유 IP 에서도 Nominatim 보다 제한이 느슨하다. 초당 3건 이하로.
async function photon(q, area) {
  const wait = 350 - (Date.now() - lastCall); if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const url = `https://photon.komoot.io/api/?limit=5&bbox=124.5,33,132,38.8&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (res.status === 429 || res.status === 403) throw Object.assign(new Error('photon 제한 ' + res.status), { stop: true });
  if (!res.ok) return null;
  const list = (await res.json()).features || [];
  const ok = list.find(f => {
    const [lng, lat] = f.geometry.coordinates, p = f.properties || {};
    const where = [p.state, p.city, p.county, p.district, p.locality].filter(Boolean).join(' ');
    return inKorea(lat, lng) && (!AREA_RE[area] || AREA_RE[area].test(where));
  });
  return ok ? [+ok.geometry.coordinates[1].toFixed(5), +ok.geometry.coordinates[0].toFixed(5)] : null;
}
async function kakao(q, area) {
  for (const kind of ['keyword', 'address']) {
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/${kind}.json?size=3&query=${encodeURIComponent(q)}`, { headers: { Authorization: 'KakaoAK ' + KAKAO }, signal: AbortSignal.timeout(15000) });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('카카오 키 오류 ' + res.status), { stop: true });
    if (!res.ok) continue;
    const docs = (await res.json()).documents || [];
    const ok = docs.find(d => inKorea(+d.y, +d.x) && (!AREA_RE[area] || AREA_RE[area].test(d.address_name || d.road_address_name || '')));
    if (ok) return [+(+ok.y).toFixed(5), +(+ok.x).toFixed(5)];
  }
  return null;
}

async function main() {
  const data = JSON.parse(await readFile(OUT, 'utf8'));
  let cache = {};
  try { cache = JSON.parse(await readFile(CACHE, 'utf8')); } catch {}

  const todo = new Map();
  let fromSrc = 0, fromCache = 0;
  for (const it of data.items) {
    delete it.geo; delete it.geoLv;
    const lat = +it.lat, lng = +it.lng;
    if (inKorea(lat, lng)) { it.geo = [+lat.toFixed(5), +lng.toFixed(5)]; it.geoLv = 'src'; fromSrc++; continue; }
    if (!it.place || NOWHERE.test(it.place)) continue;
    const k = key(it), c = cache[k];
    if (c && c.p) { it.geo = c.p; it.geoLv = c.lv; fromCache++; continue; }
    if (c && !c.p && today - c.t < 100) continue; // YYYYMMDD 숫자 차 100 ≈ 한 달
    if (!todo.has(k)) todo.set(k, it);
  }

  let found = 0, miss = 0, stopped = '';
  const t0 = Date.now();
  for (const [k, it] of todo) {
    if (Date.now() - t0 > BUDGET_MS) { stopped = '시간 초과'; break; }
    let hit = null, lv = 'none';
    try {
      for (const [q, level] of candidates(it)) {
        const p = KAKAO ? await kakao(q, it.area) : await photon(q, it.area);
        if (p) { hit = p; lv = level; break; }
      }
    } catch (e) { if (e.stop) { stopped = e.message; break; } }
    cache[k] = hit ? { p: hit, lv, t: today } : { p: null, t: today };
    hit ? found++ : miss++;
  }
  // 이번에 찾은 것까지 반영
  for (const it of data.items) {
    if (it.geo || !it.place) continue;
    const c = cache[key(it)];
    if (c && c.p) { it.geo = c.p; it.geoLv = c.lv; }
  }
  await writeFile(CACHE, JSON.stringify(Object.fromEntries(Object.entries(cache).sort()), null, 0) + '\n');
  await writeFile(OUT, JSON.stringify(data, null, 0) + '\n');
  const onMap = data.items.filter(i => i.geo).length;
  console.log(`좌표: 출처 ${fromSrc}, 캐시 ${fromCache}, 새로 찾음 ${found}, 못 찾음 ${miss}, 남은 장소 ${todo.size - found - miss}${stopped ? ' (' + stopped + ')' : ''} → 지도 표시 ${onMap}/${data.items.length}건 (${KAKAO ? '카카오' : 'Photon'})`);
}

main().catch(e => { console.error(e); process.exit(1); });
