// 데이트 코스의 '만나는 곳'에 쓸 전국 지하철·전철·기차역 목록 (오픈스트리트맵)
// 역은 거의 바뀌지 않아 수동으로 가끔 다시 만든다: node scripts/stations.mjs [overpass 결과 json]
// 결과: date/data/stations.json  { src, updated, s: [[이름, 위도, 경도, 종류(s=지하철·경전철, t=기차)], …] }
import { readFileSync, writeFileSync } from 'node:fs';

const MIRRORS = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const QUERY = '[out:json][timeout:140];area["ISO3166-1"="KR"][admin_level=2]->.k;(node(area.k)[railway=station];node(area.k)[public_transport=station][subway=yes];);out body;';

async function fetchAll() {
  for (const u of MIRRORS) {
    try {
      const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(QUERY), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'somang-date/1.0' }, signal: AbortSignal.timeout(160000) });
      if (r.ok) return (await r.json()).elements;
      console.log(u, r.status);
    } catch (e) { console.log(u, e.message); }
  }
  throw new Error('Overpass 에 닿지 못함');
}

const dist = (a, b) => { const R = 6371000, r = Math.PI / 180, x = (b[1] - a[1]) * r * Math.cos((a[0] + b[0]) / 2 * r), y = (b[0] - a[0]) * r; return Math.hypot(x, y) * R; };
const els = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')).elements : await fetchAll();
const out = [];
for (const e of els) {
  const t = e.tags || {};
  let name = (t['name:ko'] || t.name || '').replace(/\s*\(.*?\)\s*/g, '').trim();
  if (!name || e.lat == null || /[a-z]/i.test(name)) continue;
  if (!/역$/.test(name)) name += '역';
  const kind = t.station === 'train' && t.subway !== 'yes' ? 't' : 's';
  const g = [+e.lat.toFixed(5), +e.lon.toFixed(5)];
  // 환승역처럼 한 역에 노드가 여럿이면 하나만 (같은 이름 600m 안)
  if (out.some(s => s[0] === name && dist(s.slice(1, 3), g) < 600)) continue;
  out.push([name, g[0], g[1], kind]);
}
out.sort((a, b) => a[1] - b[1]);
writeFileSync('date/data/stations.json', JSON.stringify({ src: 'osm', updated: new Date().toISOString().slice(0, 10), s: out }));
console.log('역', out.length);
