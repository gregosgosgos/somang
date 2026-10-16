// 데이트 코스용 주변 장소 (카페·식당·술집·산책 명소)
// 데이트에 어울리는 행사 주변을 약 500m 격자로 나눠, 격자마다 반경 900m 안의 장소를 모은다.
// 결과는 date/data/spots.json 하나에 격자별로 쌓아 두고, 30일 지난 격자만 다시 찾는다.
//
//   KAKAO_REST_KEY=... node scripts/spots.mjs   # 카카오 로컬 카테고리 검색 (국내 장소에 가장 정확, 인기순)
//   node scripts/spots.mjs                      # 키가 없으면 오픈스트리트맵(Overpass) — 장소 수가 적고 인기순 정보가 없음
//   SPOTS_MINUTES=20                            # 한 번에 쓸 시간 (기본 20분)
//
// spots.json = { updated, src, cells: { "격자키": { t: YYYYMMDD, src, s: [[이름, 종류, 위도, 경도, 세부분류, 링크id], ...] } } }
//   종류: cafe | food | bar | walk,  링크id: 카카오 장소 id (없으면 빈 칸)

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const EVENTS = new URL('../festivals/data/events.json', import.meta.url);
const OUT = new URL('../date/data/spots.json', import.meta.url);
const KAKAO = process.env.KAKAO_REST_KEY || '';
const BUDGET_MS = Number(process.env.SPOTS_MINUTES || 20) * 60000;
const GRID = 0.005;           // 위도 0.005° ≈ 550m
const RADIUS = 900;           // m
const REFRESH_DAYS = 30;
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
  const sub = d => (d.category_name || '').split('>').map(s => s.trim()).filter(Boolean).slice(1).pop() || '';
  for (const d of await kakaoCat('CE7', lat, lng)) out.push([d.place_name, 'cafe', r5(d.y), r5(d.x), sub(d), d.id]);
  for (const d of await kakaoCat('FD6', lat, lng)) {
    const bar = /술집|호프|이자카야|와인|칵테일|바$/.test(d.category_name || '');
    out.push([d.place_name, bar ? 'bar' : 'food', r5(d.y), r5(d.x), sub(d), d.id]);
  }
  for (const d of await kakaoCat('AT4', lat, lng, 8)) out.push([d.place_name, 'walk', r5(d.y), r5(d.x), sub(d), d.id]);
  return out;
}

// ---------- 오픈스트리트맵 ----------
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
let opIdx = 0;
const CUISINE = { korean: '한식', japanese: '일식', chinese: '중식', italian: '이탈리안', pizza: '피자', burger: '버거', chicken: '치킨', coffee_shop: '커피', bakery: '베이커리', dessert: '디저트', french: '프랑스음식', thai: '태국음식', vietnamese: '베트남음식', indian: '인도음식', mexican: '멕시칸', seafood: '해산물', sushi: '초밥', ramen: '라멘', noodle: '면요리', steak_house: '스테이크', barbecue: '고기구이', asian: '아시안', western: '양식', cafe: '카페' };
async function fromOsm(lat, lng) {
  const q = `[out:json][timeout:25];(` +
    `nwr(around:${RADIUS},${lat},${lng})[amenity~"^(cafe|restaurant|bar|pub)$"][name];` +
    `nwr(around:${RADIUS},${lat},${lng})[leisure~"^(park|garden)$"][name];` +
    `nwr(around:${RADIUS},${lat},${lng})[tourism~"^(viewpoint|attraction)$"][name];` +
    `);out center tags 300;`;
  for (let tries = 0; tries < OVERPASS.length * 2; tries++) {
    const url = OVERPASS[opIdx % OVERPASS.length];
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(40000) });
      if (!res.ok) throw new Error(String(res.status));
      const els = (await res.json()).elements || [];
      return els.map(e => {
        const t = e.tags || {}, p = e.center || e;
        const name = t['name:ko'] || t.name;
        if (!name || p.lat == null) return null;
        const kind = t.amenity === 'cafe' ? 'cafe' : t.amenity === 'restaurant' ? 'food' : t.amenity ? 'bar' : 'walk';
        const sub = CUISINE[(t.cuisine || '').split(';')[0]] || (t.leisure === 'park' ? '공원' : t.leisure === 'garden' ? '정원' : t.tourism === 'viewpoint' ? '전망' : t.tourism === 'attraction' ? '명소' : '');
        return [name, kind, r5(p.lat), r5(p.lon), sub, ''];
      }).filter(Boolean);
    } catch { opIdx++; await sleep(2000 * (tries + 1)); }
  }
  throw new Error('Overpass 응답 없음');
}

// 같은 가게가 여러 번 나오거나 너무 많을 때 종류별로 몇 개만 (카카오는 이미 인기순)
const KEEP = { cafe: 12, food: 15, bar: 6, walk: 8 };
function trim(list) {
  const seen = new Set(), n = {}, out = [];
  for (const s of list) {
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
  // 아직 없는 격자 → 오래된 격자 순, 같은 조건이면 행사가 많은 곳부터
  // 카카오 키가 새로 생기면 오픈스트리트맵으로 찾은 격자도 다시 찾는다
  const todo = [...need.keys()].filter(k => {
    const c = db.cells[k];
    return !c || daysAgo(c.t) >= REFRESH_DAYS || (src === 'kakao' && c.src !== 'kakao');
  }).sort((a, b) => (db.cells[a] ? 1 : 0) - (db.cells[b] ? 1 : 0) || need.get(b) - need.get(a));

  const t0 = Date.now();
  let done = 0, failed = 0, streak = 0, stopped = '';
  for (const k of todo) {
    if (Date.now() - t0 > BUDGET_MS) { stopped = '시간 초과'; break; }
    const [lat, lng] = cellCenter(k);
    try {
      const s = trim(KAKAO ? await fromKakao(lat, lng) : await fromOsm(lat, lng));
      db.cells[k] = { t: today, src, s };
      done++; streak = 0;
      if (!KAKAO) await sleep(1500); // Overpass 는 공용 서버라 천천히
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
  await writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), src, cells }) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
