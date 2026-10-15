// 마라톤·러닝 대회: 마라톤온라인(roadrun.co.kr) 대회일정 (EUC-KR)
import { TODAY, HORIZON, ymd, today, areaFromText, text, clip, mapPool, UA } from '../lib.mjs';

const BASE = 'http://www.roadrun.co.kr/schedule/';
// 시·군·구 / 명소 → 지역 코드 (장소란에 시·도 이름이 없을 때)
const CITY = {
  1: '서울|상암|여의도|광화문|반포|잠실|올림픽공원|뚝섬|난지|한강|청계|덕수궁|서울숲|월드컵공원|평화의공원|평화의 광장|평화광장|구로|도림천|안양천 축구장|살곶이|중랑|노원|강서|양천|신정교|광나루|이촌|망원|마포|송파|강동|성동|동작|보라매|봉은사|삼성동|양재|탄천|문정|서울식물원|마곡|북서울|불광|은평|하늘공원|우이천|중랑천|영롱이',
  2: '인천|송도|청라|영종|강화|연수구|부평|계양|검단|로봇랜드',
  3: '대전|보문산|갑천|유성|엑스포과학공원',
  4: '대구|달서|수성못|금호강|이월드|83타워|화원|동촌',
  5: '광주|상무시민|풍암|무등',
  6: '부산|해운대|광안|다대포|낙동강|을숙도|기장|사직|삼락|화명|영도',
  7: '울산|태화강|간절곶|울주',
  8: '세종',
  31: '경기|수원|성남|분당|판교|용인|고양|일산|화성|동탄|부천|안산|안양|남양주|평택|의정부|시흥|파주|김포|광명|광주시|군포|하남|미사|오산|이천|안성|의왕|양주|포천|여주|동두천|과천|구리|가평|양평|연천|임진각|한국공학대|당정뜰|시화|대부도|정조대왕',
  32: '강원|춘천|원주|강릉|동해|태백|속초|삼척|홍천|횡성|영월|평창|정선|철원|화천|양구|인제|고성군|양양|대관령|치악|망상|경포|엘리시안|강촌',
  33: '충북|청주|충주|제천|보은|옥천|영동|증평|진천|괴산|음성|단양|무심천|문의|앙성',
  34: '충남|천안|공주|보령|아산|서산|논산|계룡|당진|금산|부여|서천|청양|홍성|홍주|예산|태안|꽃지|안면|신정호|삽교',
  35: '경북|포항|경주|김천|안동|구미|영주|영천|상주|문경|경산|의성|청송|영양|영덕|청도|고령|성주|칠곡|예천|봉화|울진|울릉|금오산|보문',
  36: '경남|창원|진주|통영|사천|김해|밀양|거제|양산|의령|함안|창녕|고성|남해|하동|산청|함양|거창|합천|마산|진해',
  37: '전북|전주|군산|익산|정읍|남원|김제|완주|진안|무주|장수|임실|순창|고창|부안|새만금',
  38: '전남|목포|여수|순천|나주|광양|담양|곡성|구례|고흥|보성|화순|장흥|강진|해남|영암|무안|함평|영광|장성|완도|진도|신안|솔라시도|진남',
  39: '제주|서귀포|한림|애월|성산|조천|구좌',
};
const CITY_RE = Object.entries(CITY).map(([c, s]) => [new RegExp(s), +c]);
const AREA_NAME = { 서울: 1, 인천: 2, 대전: 3, 대구: 4, 광주: 5, 부산: 6, 울산: 7, 세종: 8, 경기: 31, 강원: 32, 충북: 33, 충남: 34, 경북: 35, 경남: 36, 전북: 37, 전남: 38, 제주: 39 };
const cityArea = s => { // 문자열에서 가장 앞에 나오는 지명
  let best = 0, at = Infinity;
  for (const [re, c] of CITY_RE) { const m = s.match(re); if (m && m.index < at) { at = m.index; best = c; } }
  return best;
};
const guessArea = (place, title) => cityArea(place) || areaFromText(place) || cityArea(title);

async function getEucKr(url) {
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko' }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return new TextDecoder('euc-kr').decode(await res.arrayBuffer());
    } catch (e) { if (i === 3) throw e; await new Promise(r => setTimeout(r, 2000 * i)); }
  }
}

function parseList(html, year) {
  const rows = [];
  // 행 단위: 날짜칸 → 제목·종목칸 → 장소칸 → 주최·연락처칸
  const re = /<font size="4"[^>]*>(\d{1,2})\/(\d{1,2})<\/font>[\s\S]*?view\.php\?no=(\d+)[^>]*>([\s\S]*?)<\/a>(?:<br>\s*<font[^>]*>([\s\S]*?)<\/font>)?[\s\S]*?<div align="center">([\s\S]*?)<\/div>\s*<\/td>\s*<td width="30%">\s*<div[^>]*>([\s\S]*?)<\/div>/g;
  let m, prevMonth = 0;
  while ((m = re.exec(html))) {
    const [, mo, d, no, title, course, place, org] = m;
    if (+mo < prevMonth) year++; // 목록은 날짜순: 월이 줄면 해가 바뀐 것
    prevMonth = +mo;
    const orgText = org.replace(/<a[\s\S]*$/, '');
    const home = (org.match(/<a href="(https?:\/\/[^"]+)" target="_new"/) || [])[1] || '';
    const tel = (text(orgText).match(/☎\s*([\d-]{8,})/) || [])[1] || '';
    rows.push({
      no, start: `${year}${String(mo).padStart(2, '0')}${String(d).padStart(2, '0')}`,
      title: text(title), course: text(course || ''), place: text(place), org: text(orgText).replace(/☎.*$/, '').trim(), tel, home,
    });
  }
  return rows;
}

export async function marathon() {
  const y = today.getFullYear(), horizon = ymd(HORIZON);
  const pages = [[`${BASE}list.php`, y]]; // 기본 목록 = 올해 이번 달 무렵부터 연말까지
  if (horizon.slice(0, 4) > String(y)) pages.push([`${BASE}list.php?syear_key=${y + 1}`, y + 1]);
  const byNo = new Map();
  for (const [url, year] of pages) {
    for (const r of parseList(await getEucKr(url), year)) if (!byNo.has(r.no)) byNo.set(r.no, r);
  }
  const rows = [...byNo.values()].filter(r => r.start >= TODAY && r.start <= horizon);
  // 장소로 지역을 못 고른 대회만 상세 페이지의 '대회지역'을 본다
  const unknown = rows.filter(r => !(r.area = guessArea(r.place, r.title)));
  await mapPool(unknown, 3, async r => {
    const h = text(await getEucKr(`${BASE}view.php?no=${r.no}`));
    const a = (h.match(/대회지역\s+(\S+)/) || [])[1];
    r.area = AREA_NAME[a] || 0;
  }, 'marathon');
  return rows.map(r => ({
    id: `marathon-${r.no}`, src: 'marathon', title: r.title, start: r.start, end: r.start,
    place: r.place, area: r.area, img: '', tel: r.tel,
    homepage: r.home || `${BASE}view.php?no=${r.no}`,
    summary: clip([r.course && `종목: ${r.course}`, r.org && `주최: ${r.org}`, r.place].filter(Boolean).join(' · ')),
    price: '', kind: 'fest',
  }));
}
