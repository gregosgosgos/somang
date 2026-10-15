// 프립 FRIP — 취미·원데이클래스·액티비티. 공개 GraphQL (gql.frip.co.kr/graphql, 로그인 불필요)
import { get, clip, areaFromText, mapPool, TODAY, HORIZON, ymd } from '../lib.mjs';

const GQL = 'https://gql.frip.co.kr/graphql';
// 아웃도어, 공예DIY, 베이킹, 문화예술, 스포츠 (번개모임·온라인·뷰티·자기계발은 제외)
const CATS = [[2362, '아웃도어'], [2356, '공예DIY'], [2355, '베이킹'], [2353, '문화예술'], [2357, '스포츠']];
const PAGES = 3, CAP = 150;

const gql = async (query, variables) => {
  const j = JSON.parse(await get(GQL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0', Origin: 'https://www.frip.co.kr', Referer: 'https://www.frip.co.kr/' }, body: JSON.stringify({ query, variables }) }));
  if (j.errors) throw new Error('frip gql: ' + j.errors[0].message);
  return j.data;
};

const LIST_Q = `query($page:Int,$filter:ListingProductFilterV4){ product { listingProductsV4(page:$page,size:20,filter:$filter){ edges{ node{
  id areaName categoryName salePrice title reviewCount reviewRating productKind overseas status
  headerContents{ content{ thumbnail(width:500,height:500,crop:FILL,fetchFormat:AUTO,gravity:CENTER,quality:AUTO_ECO) } } } } } } }`;
const DETAIL_Q = `query($id:ID!){ product { product(id:$id){ id catchphrase period{startedAt endedAt} frip{ locationsOfVenue{ address label } } } } }`;

// 프립 지역 라벨('강남·서초', '안양·용인' 등) → 지역 코드
const SEOUL_GU = /강남|서초|송파|강동|마포|서대문|은평|성동|광진|종로|중구|동작|관악|용산|강서|금천|양천|노원|강북|도봉|중랑|영등포|구로|동대문|성북/;
const areaOfLabel = a => {
  if (!a) return 0;
  if (/부천|안양|용인|성남|분당|수원|화성|고양|김포|경기|일산|파주|남양주|하남|평택/.test(a)) return 31;
  if (/제주|서귀포/.test(a)) return 39;
  if (SEOUL_GU.test(a)) return 1;
  return areaFromText(a);
};
const noEmoji = s => (s || '').replace(/[\p{Extended_Pictographic}️‍⃣]/gu, '').replace(/\s+/g, ' ').trim();
const won = p => { const n = Math.round(Number(p) || 0); return n ? n.toLocaleString('ko-KR') + '원~' : ''; };
const msYmd = ms => ymd(new Date(Number(ms)));

export async function frip() {
  const cands = new Map();
  for (const [cid, cname] of CATS) {
    for (let page = 1; page <= PAGES; page++) {
      try {
        const d = await gql(LIST_Q, { page, filter: { orderType: 'POPULAR', categoryIds: [cid] } });
        for (const { node: n } of d.product.listingProductsV4.edges) {
          if (n.productKind !== 'OFFLINE' || n.overseas || cands.has(n.id)) continue;
          cands.set(n.id, { ...n, cname, rank: cands.size });
        }
      } catch (e) { console.log(`[frip] ${cname} p${page} 실패: ${e.message}`); }
    }
  }
  // 서울 쏠림을 줄인다: 서울 외 지역을 먼저 담고 나머지를 인기순 서울 상품으로 채운다
  const all = [...cands.values()];
  const nonSeoul = all.filter(n => areaOfLabel(n.areaName) !== 1).slice(0, 70);
  const pick = [...nonSeoul, ...all.filter(n => !nonSeoul.includes(n))].slice(0, CAP).sort((a, b) => a.rank - b.rank);

  const horizon = ymd(HORIZON);
  const items = pick.map(n => ({
    id: `frip-${n.id}`, src: 'frip', title: noEmoji(n.title), start: TODAY, end: horizon,
    place: n.areaName || '', area: areaOfLabel(n.areaName),
    img: n.headerContents?.[0]?.content?.thumbnail || '', tel: '',
    homepage: `https://www.frip.co.kr/products/${n.id}`,
    summary: clip(`${n.cname}·${n.categoryName}${n.reviewCount ? ` · 후기 ${n.reviewCount.toLocaleString('ko-KR')}개(★${(n.reviewRating || 0).toFixed(1)})` : ''} · 날짜 선택 예약`),
    price: won(n.salePrice), kind: 'edu',
  }));
  // 상세: 한 줄 소개, 판매 기간, 실제 진행 장소 주소
  await mapPool(items, 3, async it => {
    const p = (await gql(DETAIL_Q, { id: it.id.slice(5) })).product.product;
    if (!p) return;
    const loc = p.frip?.locationsOfVenue?.find(l => l.address) || null;
    if (loc) { it.place = loc.address; it.area = areaFromText(loc.address) || it.area; }
    if (p.period?.endedAt) {
      const e = msYmd(p.period.endedAt); if (e < it.end) it.end = e;
      const s = p.period.startedAt ? msYmd(p.period.startedAt) : TODAY; if (s > it.start) it.start = s;
    }
    if (p.catchphrase) it.summary = clip(`${it.summary.split(' · ')[0]} · ${noEmoji(p.catchphrase)} · 날짜 선택 예약`);
  }, 'frip');
  // 해외 여행·원정 상품은 국내 행사 모음에 맞지 않으므로 뺀다
  const ABROAD = /해외|일본|도쿄|오사카|후쿠오카|교토|홋카이도|오키나와|베트남|다낭|나트랑|태국|방콕|치앙마이|필리핀|세부|보홀|발리|괌|사이판|대만|타이베이|홍콩|싱가포르|몽골|유럽|하와이/;
  return items.filter(it => it.end >= TODAY && it.start <= it.end && !ABROAD.test(`${it.title} ${it.place}`));
}
