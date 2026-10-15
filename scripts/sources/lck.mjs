// LoL e스포츠: LCK·LCK CL·KeSPA Cup 은 경기별, 월즈·MSI·First Stand 등 국제대회는 스테이지별 1건
import { get, TODAY, HORIZON, ymd, clip } from '../lib.mjs';

const API = 'https://esports-api.lolesports.com/persisted/gw/getSchedule';
const KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z'; // lolesports.com 웹이 쓰는 공개 키
const DOMESTIC = { // 국내 리그(slug → 정보): 경기별
  lck: { id: '98767991310872058', name: 'LCK', place: 'LoL PARK (서울 종로구 그랑서울)', area: 1 },
  lck_challengers_league: { id: '98767991335774713', name: 'LCK CL', place: 'LoL PARK (서울 종로구 그랑서울)', area: 1 },
  kespa_cup: { id: '116929044967296666', name: 'KeSPA Cup', place: '', area: 0 },
};
const INTL = { // 국제대회: 스테이지별 묶음
  worlds: { id: '98767975604431411', name: '롤드컵(LoL 월드 챔피언십)' },
  msi: { id: '98767991325878492', name: 'MSI' },
  first_stand: { id: '113464388705111224', name: 'First Stand' },
  ewc_lol: { id: '116838530616006090', name: 'e스포츠 월드컵 LoL' },
};
const KST = iso => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
const hm = iso => { const d = new Date(new Date(iso).getTime() + 9 * 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };

export async function lck() {
  const ids = [...Object.values(DOMESTIC), ...Object.values(INTL)].map(l => l.id).join(',');
  const headers = { 'x-api-key': KEY, 'User-Agent': 'Mozilla/5.0' };
  const events = [];
  let token = '', guard = 0;
  do { // 첫 페이지는 '현재' 구간; newer 토큰을 따라 미래 경기까지
    const url = `${API}?hl=ko-KR&leagueId=${ids}${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
    const s = JSON.parse(await get(url, { headers })).data.schedule;
    events.push(...s.events);
    token = s.pages?.newer;
  } while (token && ++guard < 6);

  const logo = {}; // 리그 로고 (실패해도 무시)
  try { for (const l of JSON.parse(await get(API.replace('getSchedule', 'getLeagues') + '?hl=ko-KR', { headers })).data.leagues) logo[l.slug] = (l.image || '').replace(/^http:/, 'https:'); } catch {}
  const horizon = ymd(HORIZON);
  const up = events.filter(e => e.type === 'match' && e.state !== 'completed' && KST(e.startTime) >= TODAY && KST(e.startTime) <= horizon);
  const seen = new Set(), items = [], stages = new Map();
  for (const e of up) {
    const m = e.match || {}, slug = e.league?.slug || '';
    const teams = (m.teams || []).map(t => t.name || t.code || 'TBD');
    const vs = teams.length === 2 ? `${teams[0]} vs ${teams[1]}` : teams.join(' vs ');
    if (DOMESTIC[slug]) {
      if (!m.id || seen.has(m.id)) continue; seen.add(m.id);
      const L = DOMESTIC[slug], day = KST(e.startTime);
      items.push({
        id: `lck-${m.id}`, src: 'lck', title: `${L.name} ${vs}`, start: day, end: day,
        place: L.place, area: L.area, img: logo[slug] || '', tel: '',
        homepage: 'https://lolesports.com/ko-KR/leagues/' + (e.league?.slug || 'lck'),
        summary: clip(`${L.name} ${e.blockName || ''} · ${hm(e.startTime)} 시작 · ${m.strategy?.count ? `Bo${m.strategy.count}` : ''} · ${vs}`), price: '', kind: 'sport',
      });
    } else {
      const key = `${e.league?.slug}|${e.blockName}`;
      const g = stages.get(key) || { e, start: KST(e.startTime), end: KST(e.startTime), games: [] };
      g.start = KST(e.startTime) < g.start ? KST(e.startTime) : g.start;
      g.end = KST(e.startTime) > g.end ? KST(e.startTime) : g.end;
      if (!teams.every(t => t === 'TBD')) g.games.push(`${KST(e.startTime).slice(4, 6)}/${KST(e.startTime).slice(6)} ${vs}`);
      stages.set(key, g);
    }
  }
  for (const g of stages.values()) {
    const lname = INTL[g.e.league?.slug]?.name || g.e.league?.name;
    const year = g.start.slice(0, 4);
    items.push({
      id: `lck-${g.e.league?.slug}-${year}-${g.e.blockName}`.replace(/\s+/g, ''), src: 'lck',
      title: `${lname} ${year} ${g.e.blockName}`, start: g.start, end: g.end,
      place: '해외 개최 (국내 온라인 중계)', area: 0, img: logo[g.e.league?.slug] || '', tel: '',
      homepage: `https://lolesports.com/ko-KR/leagues/${g.e.league?.slug}`,
      summary: clip(`LCK 팀이 출전하는 국제대회 ${g.e.blockName} 스테이지. ${g.games.length ? g.games.join(', ') : '대진 미정'}`), price: '', kind: 'sport',
    });
  }
  return items.sort((a, b) => a.start.localeCompare(b.start));
}
