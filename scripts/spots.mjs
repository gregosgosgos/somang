// 데이트 코스용 주변 장소 (카페·식당·술집·산책 명소)
// 데이트에 어울리는 행사 주변과 date/data/hoods.json 의 데이트 동네를 약 550m 격자로 나눠, 격자마다 반경 900m 안의 장소를 모은다.
// 결과는 date/data/spots.json 하나에 격자별로 쌓아 두고, 30일 지난 격자만 다시 찾는다.
//
//   KAKAO_REST_KEY=... node scripts/spots.mjs   # 카카오 로컬 카테고리 검색 (국내 장소에 가장 정확, 인기순)
//   node scripts/spots.mjs                      # 키가 없으면 오픈스트리트맵(Overpass) — 장소 수가 적고 인기순 정보가 없음
//   SPOTS_MINUTES=20                            # 한 번에 쓸 시간 (기본 20분)
//
// spots.json = { updated, src, v, cells: { "격자키": { t: YYYYMMDD, src, v, s: [[이름, 종류, 위도, 경도, 세부분류, 링크id, 표시, 업종원문, 영업시간], ...] } } }
//   종류: cafe | food | bar | walk,  링크id: 카카오 장소 id (없으면 빈 칸)
//   표시: B 체인(브랜드)  T 야외석·테라스  P 반려동물 동반  V 비건 메뉴,  업종원문: OSM cuisine 또는 카카오 분류 전체,  영업시간: OSM opening_hours
//   (뒤 세 칸은 비어 있으면 생략)

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const EVENTS = new URL('../festivals/data/events.json', import.meta.url);
const OUT = new URL('../date/data/spots.json', import.meta.url);
const HOODS = new URL('../date/data/hoods.json', import.meta.url); // 행사가 없어도 코스를 짤 수 있는 데이트 동네
const KAKAO = process.env.KAKAO_REST_KEY || '';
const BUDGET_MS = Number(process.env.SPOTS_MINUTES || 20) * 60000;
const GRID = 0.005;           // 위도 0.005° ≈ 550m
const RADIUS = 900;           // m
const REFRESH_DAYS = 30;
const VER = 2; // 저장 형식이 바뀌면 올린다 (예전 형식 격자는 다시 찾는다)
const UA = 'somang-festivals/1.0 (https://github.com/gregosgosgos/somang)';
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const daysAgo = t => (Date.parse(`${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6)}`) - Date.parse(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6)}`)) / 864e5;

export const cellKey = (lat, lng) => `${Math.round(lat / GRID)}_${Math.round(lng / GRID)}`;
const cellCenter = k => k.split('_').map(n => +(n * GRID).toFixed(5));

// 데이트 코스의 중심이 될 만한 행사
function dateWorthy(it) {
  const a = it.ai || {};
  if (!it.geo || !['src', 'place'].includes(it.geoLv)) return false;
  if ((it.end || '9') < today || it.kind === 'fair') return false;
  return (a.who || []).includes('연인·데이트') || (a.mood || []).includes('로맨틱');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
// 이름만 봐도 아는 체인 (브랜드 정보가 없는 곳도 걸러지게)
const CHAIN = /스타벅스|이디야|투썸|메가\s*(MGC)?\s*커피|컴포즈|빽다방|할리스|파스쿠찌|커피빈|Coffee Bean|폴바셋|엔제리너스|매머드|더벤티|바나프레소|탐앤탐스|카페베네|공차|설빙|맥도날드|버거킹|롯데리아|KFC|맘스터치|김밥천국|본죽|파리바게뜨|뚜레쥬르|서브웨이|도미노|피자헛|교촌|BBQ|bhc|이삭토스트|배스킨|던킨|한솥|생활맥주|역전할머니|홍콩반점|백채김치찌개|노브랜드버거|프랭크버거|요거프레소|빚은|Starbucks|Twosome/i;
// 뒤 세 칸(표시·업종원문·영업시간)은 비어 있으면 붙이지 않아 파일을 가볍게
const withExtra = (row, flags, cuisine, oh) => {
  const ext = [flags || '', cuisine || '', oh || ''];
  while (ext.length && !ext[ext.length - 1]) ext.pop();
  return ext.length ? [...row, ...ext] : row;
};
function dist(a, b) { // 미터
  const R = 6371000, toR = Math.PI / 180, dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const r5 = n => +(+n).toFixed(5);

// ---------- 카카오 ----------
async function kakaoCat(code, lat, lng, size = 15) {
  const url = `https://dapi.kakao.com/v2/local/search/category.json?category_group_code=${code}&x=${lng}&y=${lat}&radius=${RADIUS}&sort=accuracy&size=${size}`;
  const res = await fetch(url, { headers: { Authorization: 'KakaoAK ' + KAKAO }, signal: AbortSignal.timeout(15000) });
  if (res.status === 401 || res.status === 403 || res.status === 429) throw Object.assign(new Error('카카오 ' + res.status), { stop: true });
  if (!res.ok) return [];
  return (await res.json()).documents || [];
}
async function fromKakao(lat, lng) {
  const out = [];
  // 카카오 분류는 '음식점 > 카페 > 커피전문점 > 스타벅스'처럼 체인이면 맨 끝이 브랜드 이름
  const parts = d => (d.category_name || '').split('>').map(s => s.trim()).filter(Boolean);
  const isBrand = d => { const p = parts(d), last = p[p.length - 1] || ''; return p.length >= 3 && last.length >= 2 && d.place_name.replace(/\s/g, '').startsWith(last.replace(/\s/g, '')); };
  const sub = d => { const p = parts(d).slice(1); if (isBrand(d)) p.pop(); return p.pop() || ''; };
  const row = (d, kind) => withExtra([d.place_name, kind, r5(d.y), r5(d.x), sub(d), d.id], isBrand(d) || CHAIN.test(d.place_name) ? 'B' : '', d.category_name);
  for (const d of await kakaoCat('CE7', lat, lng)) out.push(row(d, 'cafe'));
  for (const d of await kakaoCat('FD6', lat, lng)) {
    const bar = /술집|호프|이자카야|와인|칵테일|바$/.test(d.category_name || '');
    out.push(row(d, bar ? 'bar' : 'food'));
  }
  for (const d of await kakaoCat('AT4', lat, lng, 8)) out.push([d.place_name, 'walk', r5(d.y), r5(d.x), sub(d), d.id]);
  return out;
}

// ---------- 오픈스트리트맵 ----------
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
let opIdx = 0;
const CUISINE = { korean: '한식', japanese: '일식', chinese: '중식', italian: '이탈리안', pizza: '피자', burger: '버거', chicken: '치킨', coffee_shop: '커피', bakery: '베이커리', dessert: '디저트', french: '프랑스음식', thai: '태국음식', vietnamese: '베트남음식', indian: '인도음식', mexican: '멕시칸', seafood: '해산물', sushi: '초밥', ramen: '라멘', noodle: '면요리', steak_house: '스테이크', barbecue: '고기구이', asian: '아시안', western: '양식', cafe: '카페' };
// 오픈스트리트맵은 구역마다 따로 묻지 않고 약 4~5km 사각형을 한 번에 받아 구역별로 나눈다 (공용 서버라 요청 수를 줄여야 빠르다)
async function fromOsm([s, w, n, e]) {
  const bb = `${s},${w},${n},${e}`;
  const q = `[out:json][timeout:90];(` +
    `nwr(${bb})[amenity~"^(cafe|restaurant|bar|pub)$"][name];` +
    `nwr(${bb})[leisure~"^(park|garden)$"][name];` +
    `nwr(${bb})[tourism~"^(viewpoint|attraction)$"][name];` +
    `);out center tags;`;
  for (let tries = 0; tries < OVERPASS.length * 2; tries++) {
    const url = OVERPASS[opIdx % OVERPASS.length];
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(String(res.status));
      const els = (await res.json()).elements || [];
      return els.map(e => {
        const t = e.tags || {}, p = e.center || e;
        const name = t['name:ko'] || t.name;
        if (!name || p.lat == null) return null;
        const kind = t.amenity === 'cafe' ? 'cafe' : t.amenity === 'restaurant' ? 'food' : t.amenity ? 'bar' : 'walk';
        const sub = CUISINE[(t.cuisine || '').split(';')[0]] || (t.leisure === 'park' ? '공원' : t.leisure === 'garden' ? '정원' : t.tourism === 'viewpoint' ? '전망' : t.tourism === 'attraction' ? '명소' : '');
        const flags = (t.brand || t['brand:wikidata'] || CHAIN.test(name) ? 'B' : '') + (t.outdoor_seating === 'yes' ? 'T' : '') +
          (/^(yes|leashed|outside)$/.test(t.dog || '') ? 'P' : '') + (/^(yes|only)$/.test(t['diet:vegan'] || '') ? 'V' : '');
        return withExtra([name, kind, r5(p.lat), r5(p.lon), sub, ''], flags, t.cuisine, t.opening_hours);
      }).filter(Boolean);
    } catch { opIdx++; await sleep(2000 * (tries + 1)); }
  }
  throw new Error('Overpass 응답 없음');
}

// 같은 가게가 여러 번 나오거나 너무 많을 때 종류별로 몇 개만 (카카오는 이미 인기순)
// 종류별로 몇 개만 남기되 체인이 아닌 곳을 먼저 (가까운 순서는 그대로)
const KEEP = { cafe: 16, food: 20, bar: 8, walk: 8 };
function trim(list) {
  const seen = new Set(), n = {}, out = [];
  const chain = s => (s[6] || '').includes('B') ? 1 : 0;
  for (const s of [...list].sort((a, b) => chain(a) - chain(b))) {
    const k = s[0] + s[2].toFixed(3);
    if (seen.has(k)) continue; seen.add(k);
    n[s[1]] = (n[s[1]] || 0) + 1;
    if (n[s[1]] <= KEEP[s[1]]) out.push(s);
  }
  return out;
}

async function main() {
  const ev = JSON.parse(await readFile(EVENTS, 'utf8'));
  let db = { cells: {} };
  try { db = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
  const src = KAKAO ? 'kakao' : 'osm';

  const need = new Map();
  for (const it of ev.items) if (dateWorthy(it)) {
    const k = cellKey(it.geo[0], it.geo[1]);
    need.set(k, (need.get(k) || 0) + 1);
  }
  // 데이트 동네는 행사와 상관없이 늘 채워 둔다 (먼저 찾도록 가중치를 크게)
  try {
    for (const hd of JSON.parse(await readFile(HOODS, 'utf8')).hoods) {
      const k = cellKey(hd.geo[0], hd.geo[1]);
      need.set(k, (need.get(k) || 0) + 50);
    }
  } catch {}
  // 아직 없는 격자 → 오래된 격자 순, 같은 조건이면 행사가 많은 곳부터
  // 카카오 키가 새로 생기면 오픈스트리트맵으로 찾은 격자도 다시 찾는다
  const todo = [...need.keys()].filter(k => {
    const c = db.cells[k];
    return !c || c.v !== VER || daysAgo(c.t) >= REFRESH_DAYS || (src === 'kakao' && c.src !== 'kakao');
  }).sort((a, b) => (db.cells[a] ? 1 : 0) - (db.cells[b] ? 1 : 0) || need.get(b) - need.get(a));
  const stamp = s => ({ t: today, src, v: VER, s });

  const t0 = Date.now();
  let done = 0, failed = 0, streak = 0, stopped = '';
  if (!KAKAO) {
    // 가까운 구역끼리 약 4.4km × 4.5km 묶음으로
    const tiles = new Map();
    for (const k of todo) {
      const [lat, lng] = cellCenter(k), tk = `${Math.floor(lat / 0.04)}_${Math.floor(lng / 0.05)}`;
      if (!tiles.has(tk)) tiles.set(tk, []);
      tiles.get(tk).push(k);
    }
    const pad = RADIUS / 111000 * 1.3;
    for (const keys of [...tiles.values()].sort((a, b) => b.length - a.length)) {
      if (Date.now() - t0 > BUDGET_MS) { stopped = '시간 초과'; break; }
      const pts = keys.map(cellCenter);
      const box = [Math.min(...pts.map(p => p[0])) - pad, Math.min(...pts.map(p => p[1])) - pad, Math.max(...pts.map(p => p[0])) + pad, Math.max(...pts.map(p => p[1])) + pad].map(v => +v.toFixed(4));
      try {
        const all = await fromOsm(box);
        for (const k of keys) {
          const c = cellCenter(k);
          const near = all.map(s => [s, dist(c, [s[2], s[3]])]).filter(x => x[1] <= RADIUS).sort((a, b) => a[1] - b[1]).map(x => x[0]);
          db.cells[k] = stamp(trim(near));
          done++;
        }
        streak = 0;
        await sleep(2000); // 공용 서버라 천천히
      } catch (e) {
        if (++streak >= 5) { stopped = e.message; break; }
        failed += keys.length;
      }
      await save(db, src);
    }
  }
  for (const k of KAKAO ? todo : []) {
    if (Date.now() - t0 > BUDGET_MS) { stopped = '시간 초과'; break; }
    const [lat, lng] = cellCenter(k);
    try {
      db.cells[k] = stamp(trim(await fromKakao(lat, lng)));
      done++; streak = 0;
    } catch (e) {
      // 키 오류·한도 초과는 바로 멈추고, 서버가 잠깐 안 되는 건 그 격자만 건너뛴다 (연속 8번이면 멈춤)
      if (e.stop || ++streak >= 8) { stopped = e.message; break; }
      failed++;
    }
    if (done % 50 === 0) await save(db, src);
  }
  // 90일 넘게 쓰이지 않은 격자는 버린다
  for (const [k, c] of Object.entries(db.cells)) if (!need.has(k) && daysAgo(c.t) > 90) delete db.cells[k];
  await save(db, src);
  const covered = [...need.keys()].filter(k => db.cells[k]?.s?.length).length;
  console.log(`데이트 장소: 격자 ${need.size}곳 중 ${covered}곳 준비 (이번에 ${done}곳, 실패 ${failed}곳, 남은 ${todo.length - done}곳${stopped ? ', ' + stopped : ''}, ${KAKAO ? '카카오' : '오픈스트리트맵'})`);
}
async function save(db, src) {
  await mkdir(new URL('.', OUT), { recursive: true });
  const cells = Object.fromEntries(Object.entries(db.cells).sort());
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), src, v: VER, cells }) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
