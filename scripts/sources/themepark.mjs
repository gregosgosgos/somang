// 놀이공원 시즌 축제·공연: 에버랜드(이벤트 API), 롯데월드 어드벤처(공연 API)
// 서울랜드는 축제 기간이 포스터 이미지에만 있어 제외, 롯데월드 부산은 확인 불가(접속 차단)
import { get, TODAY, HORIZON, ymd, clip } from '../lib.mjs';

const FEST = /축제|페스티벌|festival|fest\b|카니발|carnival|사파리|불꽃|퍼레이드|parade|서커스|공연|쇼\b|show|밴드|할로윈|halloween|크리스마스|christmas|윈터|스노우|튤립|장미|라이트|lights?\b|나이트|야간|blood|호러|고스트|展|기묘한/i;
const NOT = /MD|굿즈|상품|쿠폰|할인|혜택|등급|카드|캐시백|패스|리워즈|프로모션|증정|커뮤니티|챌린지|콘테스트/i;
const horizon = () => ymd(HORIZON);
const span = (s, e) => (Date.UTC(+e.slice(0, 4), +e.slice(4, 6) - 1, +e.slice(6)) - Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6))) / 864e5;

async function everland() {
  const url = 'https://wwwapi.everland.com/api/v1/iam/evt/event?eventPublctKindCd=EL&eventKindCd=&currentPage=1&pagePerCount=100';
  const list = JSON.parse(await get(url, { headers: { Accept: 'application/json', 'Accept-Language': 'ko' } })).eventList || [];
  const out = [];
  for (const e of list) {
    if (e.eventKindCd !== '02' || e.exposrYn === 'N') continue; // 02 = 안내형 콘텐츠(참여·쿠폰 이벤트 제외)
    const name = (e.eventName || '').trim();
    if (!FEST.test(name) || NOT.test(name)) continue;
    const start = (e.periodDispStartDtm || e.eventStartDtm || '').slice(0, 8);
    const end = (e.periodDispEndDtm || e.eventEndDtm || '').slice(0, 8);
    if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || end < TODAY || start > horizon() || end >= '2099') continue;
    out.push({
      id: `themepark-everland-${e.eventId}`, src: 'themepark', title: `에버랜드 ${name.replace(/^에버랜드(의)?\s*/, '')}`, start, end,
      place: '에버랜드 (경기 용인시 처인구)', area: 31, img: e.thumbnailImagUrl || '', tel: '',
      homepage: 'https://www.everland.com/everland/event',
      summary: clip((e.eventDesc || '').replace(/<img[^>]*>/g, ' ') || name), price: '', kind: 'fest',
    });
  }
  return out;
}

async function lotteworld() {
  const body = JSON.stringify({ srchDate: '', srchPlyCsfCd: 'ALL', srchPlySeq: '', srchTime: '', storeCd: 'HC01801', langCd: 'HC01701', isActiveTab: 0, deviceType: 'mobile' });
  const res = JSON.parse(await get('https://adventure.lotteworld.com/api/enjoy/performance/list', {
    method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: 'https://adventure.lotteworld.com/enjoy/performance/list' },
  }));
  const seen = new Set(), out = [];
  for (const p of res.pifPlyMstVoList || []) {
    const name = (p.mstPlyNm || p.plyNm || '').trim(), start = p.plyBgnDt || '', end = p.plyEndDt || '';
    if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || end < TODAY || start > horizon()) continue;
    if (span(start, end) > 200) continue; // 연중 상설 공연 제외 → 시즌 공연·축제만
    const key = name.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) continue; seen.add(key);
    const img = p.thmbFileList?.[0]?.flPath || p.imgFileList?.[0]?.flPath || '';
    out.push({
      id: `themepark-lotteworld-${p.plySeq}`, src: 'themepark', title: `롯데월드 어드벤처 ${name}`, start, end,
      place: `롯데월드 어드벤처 ${(p.pstnDesc || p.pstnCdNm || '').replace(/^어드벤처\s*/, '')} (서울 송파구 잠실)`.replace(/\s+\(/, ' ('), area: 1,
      img: img ? `https://adventure.lotteworld.com/api/upload${img}` : '', tel: '',
      homepage: `https://adventure.lotteworld.com/enjoy/performance/detail?srchPlySeq=${p.plySeq}`,
      summary: clip(`[${p.plyCsfCdNm || '공연'}] ${p.introCntn || name}`), price: '', kind: 'fest',
    });
  }
  return out;
}

export async function themepark() {
  const items = [];
  for (const [name, fn] of [['everland', everland], ['lotteworld', lotteworld]]) {
    try { items.push(...await fn()); } catch (e) { console.log(`[themepark] ${name} 실패: ${e.message}`); }
  }
  return items.sort((a, b) => a.start.localeCompare(b.start));
}
