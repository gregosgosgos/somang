// 숲나들e — 자연휴양림 숲해설·목공예 등 체험 프로그램. 휴양림별 '프로그램' 안내 페이지(서버 렌더링 HTML)를 읽는다.
// (통합 '프로그램 예약' 화면은 로그인이 필요하지만 휴양림별 안내 목록은 공개)
import { get, text, clip, areaFromText, mapPool, TODAY, HORIZON, ymd } from '../lib.mjs';

const HOST = 'https://www.foresttrip.go.kr';
const CAP = 150, PER_FOREST = 2;
// 주의: 'Accept-Language: ko' 를 보내면 서버가 /com/error.do 로 돌려보낸다 → 헤더를 직접 지정
const HDR = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9' } };

function parse(id, h) {
  const name = text(h.match(/<title>([^<]*)/)?.[1] || '').split(/\s+-\s+|\s*\|/)[0].replace(/^산림청\s*/, '').trim();
  const ftel = h.match(/전화\s*:\s*(0\d{1,2}-\d{3,4}-\d{4})/)?.[1] || '';
  const addr = text(h.match(/주소\s*:\s*\(우\s*[\d-]*\s*\)\s*([^|<]+)/)?.[1] || '');
  const progs = [];
  for (const b of h.split('<div class="pw_item">').slice(1)) {
    const goods = b.match(/goodsId=([A-Z0-9]+)/)?.[1];
    const title = text(b.match(/<strong class="pp_ti">([\s\S]*?)<\/strong>/)?.[1]);
    const body = (b.match(/<div class="pp_txt"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '').replace(/<br\s*\/?>|<\/p>/gi, '\n');
    const lines = text(body.replace(/\n/g, ' ¶ ')).split('¶').map(s => s.replace(/^[\s‣·•\-*]+/, '').trim()).filter(Boolean);
    const field = re => lines.find(l => re.test(l))?.replace(/^[^:：]*[:：]\s*/, '') || '';
    const per = b.match(/이용일\s*:\s*(\d{4})\.(\d\d)\.(\d\d)\s*~\s*(\d{4})\.(\d\d)\.(\d\d)/);
    const img = b.match(/<img[^>]+src="(https:\/\/image\.foresttrip\.go\.kr\/[^"]+\.(?:jpe?g|png|gif|webp))"/i)?.[1] || '';
    if (!goods || !title) continue;
    progs.push({
      goods, title, img, s: per ? per.slice(1, 4).join('') : TODAY, e: per ? per.slice(4, 7).join('') : ymd(HORIZON),
      when: [field(/운영(요일|기간|일시|시기)/), field(/운영시간|시간/)].filter(Boolean).join(' '),
      fee: field(/이용요금|참가비|체험비|요금/), what: field(/프로그램\s*내용|내용/) || field(/운영대상|대상/),
      tel: (lines.join(' ').match(/0\d{1,2}-\d{3,4}-\d{4}/) || [''])[0],
    });
  }
  for (const p of progs) p.tel ||= ftel;
  return { id, name, addr, progs };
}

export async function foresttrip() {
  // 휴양림 ID 목록은 메인 페이지의 지도/예약 링크에 들어 있다 (insttId=0101, ID02030035 …)
  const main = await get(`${HOST}/main.do?hmpgId=FRIP`, HDR);
  const ids = [...new Set([...main.matchAll(/insttId=((?:ID)?\d{4,8}|[A-Z]{3,6})\b/g)].map(m => m[1]))];
  const forests = [];
  await mapPool(ids, 2, async id => {
    const h = await get(`${HOST}/pot/rm/fa/selectPrgrmListView.do?hmpgId=${id}&menuId=002003`, HDR);
    const f = parse(id, h);
    if (f.progs.length) forests.push(f);
  }, 'foresttrip');
  forests.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

  const horizon = ymd(HORIZON), items = [];
  // 휴양림마다 1개씩 돌아가며 담아 지역을 고르게 (최대 PER_FOREST 개)
  for (let round = 0; round < PER_FOREST && items.length < CAP; round++) {
    for (const f of forests) {
      const live = f.progs.filter(p => p.e >= TODAY && p.s <= horizon);
      const p = live[round];
      if (!p || items.length >= CAP) continue;
      const fee = p.fee.replace(/\s+/g, ' ');
      items.push({
        id: `foresttrip-${p.goods}`, src: 'foresttrip', title: `${p.title} (${f.name})`,
        start: p.s > TODAY ? p.s : TODAY, end: p.e < horizon ? p.e : horizon,
        place: [f.name, f.addr].filter(Boolean).join(', '), area: areaFromText(f.addr) || areaFromText(f.name),
        img: p.img, tel: p.tel, homepage: `${HOST}/pot/rm/fa/selectPrgrmListView.do?hmpgId=${f.id}&menuId=002003`,
        summary: clip(`휴양림 체험프로그램 · ${[p.when, p.what].filter(Boolean).join(' · ')}`),
        price: /무료/.test(fee) ? '무료' : clip(fee, 40), kind: 'edu',
      });
    }
  }
  return items;
}
