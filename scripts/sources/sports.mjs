// 국내 프로스포츠 경기 일정 (앞으로 30일): 네이버 스포츠 일정 API (인증 불필요, Referer 만 필요)
import { get, TODAY, today, addDays, dashed, areaFromText } from '../lib.mjs';

const API = 'https://api-gw.sports.naver.com/schedule/games';
const LEAGUES = [ // [upperCategoryId, categoryId, 표시명, 네이버 일정 페이지]
  ['kbaseball', 'kbo', 'KBO', 'https://m.sports.naver.com/kbaseball/schedule/index?category=kbo'],
  ['kfootball', 'kleague', 'K리그1', 'https://m.sports.naver.com/kfootball/schedule/index?category=kleague'],
  ['kbasketball', 'kbl', 'KBL', 'https://m.sports.naver.com/kbasketball/schedule/index?category=kbl'],
  ['kbasketball', 'wkbl', 'WKBL', 'https://m.sports.naver.com/kbasketball/schedule/index?category=wkbl'],
  ['kvolleyball', 'kovo', 'V-리그 남자부', 'https://m.sports.naver.com/kvolleyball/schedule/index?category=kovo'],
  ['kvolleyball', 'wkovo', 'V-리그 여자부', 'https://m.sports.naver.com/kvolleyball/schedule/index?category=wkovo'],
];
const CAP = 200;
// 네이버가 짧게 주는 야구장 이름 → 정식 이름
const KBO_PARK = {
  잠실: '잠실야구장 (서울)', 고척: '고척스카이돔 (서울)', 문학: '인천SSG랜더스필드', 수원: '수원KT위즈파크', 대구: '대구삼성라이온즈파크',
  광주: '광주-기아챔피언스필드', 사직: '부산 사직야구장', 대전: '대전 한화생명볼파크', 창원: '창원NC파크', 포항: '포항야구장', 울산: '울산문수야구장', 청주: '청주야구장',
};
// 주소에 시·도 이름이 없는 경기장 → 지역 코드
const VENUE_AREA = [
  [/장충|잠실|고척|상암|목동|서울/, 1], [/계양|삼산|문학|인천/, 2], [/충무|대전/, 3], [/대구/, 4], [/광주|숲 스타디움|페퍼/, 5], [/사직|강서|부산/, 6],
  [/문수|동천|울산/, 7], [/화성|평택|수원|안양|고양|부천|용인|성남|안산|의정부|김포|이충/, 31],
  [/원주|강릉|춘천|강원/, 32], [/청주|충주/, 33], [/천안|유관순|아산/, 34], [/김천|포항|구미|안동|경북/, 35], [/창원|김해|경남/, 36],
  [/전주|군산|익산/, 37], [/진남|여수|광양|순천|목포/, 38], [/제주|서귀포/, 39],
];
const ROUND = { kbo_ps_wc: '와일드카드', kbo_ps_sp: '준플레이오프', kbo_ps_po: '플레이오프', kbo_ps_ks: '한국시리즈' };
const placeholder = n => !n || /TBD|미정|\d위|[AB]조|승자|패자|[AB]승$|[AB]패$/.test(n);

export async function sports() {
  const from = dashed(today), to = dashed(addDays(today, 30));
  const headers = { Referer: 'https://m.sports.naver.com/', Origin: 'https://m.sports.naver.com' };
  const items = [];
  for (const [up, cat, label, page] of LEAGUES) {
    let games = [];
    try {
      const url = `${API}?fields=basic,stadium,title,roundCode&upperCategoryId=${up}&categoryId=${cat}&fromDate=${from}&toDate=${to}&size=500`;
      games = JSON.parse(await get(url, { headers })).result?.games || [];
    } catch (e) { console.log(`[sports] ${label} 실패: ${e.message}`); continue; }
    for (const g of games) {
      if (g.cancel || g.statusCode === 'CANCEL' || g.statusCode === 'RESULT') continue;
      if (placeholder(g.homeTeamName) || placeholder(g.awayTeamName)) continue;
      const day = (g.gameDate || '').replace(/-/g, '');
      if (!/^\d{8}$/.test(day) || day < TODAY) continue;
      const st = g.stadium || '';
      const place = cat === 'kbo' ? (KBO_PARK[st] || st) : st;
      let area = 0;
      for (const [re, c] of VENUE_AREA) if (re.test(st)) { area = c; break; }
      if (!area) area = areaFromText(`${st} ${g.homeTeamName}`);
      const round = ROUND[g.roundCode] || (/cup/.test(g.roundCode || '') ? 'KOVO컵' : /_ps|po$|playoff/.test(g.roundCode || '') ? '포스트시즌' : '');
      const time = (g.gameDateTime || '').slice(11, 16);
      items.push({
        id: `sports-${cat}-${g.gameId}`, src: 'sports',
        title: `${label}${round ? ' ' + round : ''} ${g.awayTeamName} vs ${g.homeTeamName}`,
        start: day, end: day, place, area,
        img: (g.homeTeamEmblemUrl || '').replace(/^http:/, 'https:'), tel: '',
        homepage: page,
        summary: `${label}${round ? ' ' + round : ''} · ${g.awayTeamName}(원정) vs ${g.homeTeamName}(홈) · ${time ? time + ' 경기 시작' : ''}${place ? ' · ' + place : ''}`.slice(0, 140),
        price: '', kind: 'sport',
      });
    }
  }
  // 가까운 날짜부터 최대 CAP 건
  return items.sort((a, b) => a.start.localeCompare(b.start)).slice(0, CAP);
}
