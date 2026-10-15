// 수집기 공용 도우미: HTTP 요청, 날짜, 지역 판정, 텍스트 정리.
// scripts/collect.mjs 와 scripts/sources/*.mjs 가 함께 쓴다.

// 일부 사이트(킨텍스)는 브라우저가 아닌 UA를 거부하므로 일반 브라우저 UA를 쓴다
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const GW = 'https://apis.data.go.kr';

const today = new Date();
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dashed = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dotted = d => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
const TODAY = ymd(today);
const HORIZON = addDays(today, 180); // 앞으로 6개월

const AREA_BY_NAME = [
  ['서울', 1], ['인천', 2], ['대전', 3], ['대구', 4], ['광주', 5], ['부산', 6], ['울산', 7], ['세종', 8],
  ['경기', 31], ['강원', 32], ['충북', 33], ['충청북', 33], ['충남', 34], ['충청남', 34], ['경북', 35], ['경상북', 35],
  ['경남', 36], ['경상남', 36], ['전북', 37], ['전라북', 37], ['전남', 38], ['전라남', 38], ['제주', 39]];
// 주소 없이 장소명만 있을 때 쓰는 유명 장소 → 지역 힌트 (티켓 사이트용)
const VENUE_HINTS = [
  [/경복궁|창덕궁|덕수궁|창경궁|종묘|국립중앙박물관|고궁박물관|북촌|홍대|성수|한남|이태원|잠실|코엑스|DDP|동대문|예술의전당|롯데월드|롯데뮤지엄|더현대|여의도|용산|강남|신촌|합정|을지로|명동|인사동|삼청|청담|압구정|마곡|노들섬|세종문화회관|국립현대미술관 서울|서울시립|그라운드시소|뮤지엄산/, 1],
  // 티켓 사이트가 주소 없이 공연장 이름만 주는 경우가 많아 서울의 주요 공연장을 따로 둔다
  [/대학로|롯데콘서트홀|블루스퀘어|샤롯데|올림픽공원|올림픽홀|KSPO ?DOME|핸드볼경기장|아르코|명화라이브홀|명륜|디큐브|상상마당|연세대|백주년기념관|무신사 ?개러지|롤링홀|성균관대|유니플렉스|예스24 ?아트원|국립정동|정동극장|광림아트|한전아트|강동아트|충무아트|마포아트|KBS ?아레나|평화의전당|영산아트|구로|크레디아클래식|GS아트센터|LG아트센터|CKL ?스테이지|동덕여|흰물결|전쟁기념관|예그린|아라아트|인사아트|성신여대|노원|상명아트|JTN ?아트홀|틴틴홀|스카이씨어터|한성아트홀|쿼드|1975 ?씨어터|우리카드홀|예술공간 휴서사|세빛섬|고척|잠실|상암|장충|서울/, 1],
  [/인스파이어|영종|청라/, 2],
  [/안산|김포|하남|의정부|남양주|구리|시흥|화성|평택|오산|이천|여주|양평|가평|포천|동두천|연천|군포|의왕/, 31],
  [/해운대|광안리|벡스코|부산/, 6], [/킨텍스|일산|고양|수원|용인|성남|판교|파주|광명|안양|부천|과천|에버랜드|뮤지엄 산|원주/, 31],
  [/대구/, 4], [/인천|송도|파라다이스시티/, 2], [/광주/, 5], [/대전/, 3], [/울산/, 7], [/세종/, 8],
  [/제주|서귀포/, 39], [/강릉|속초|춘천|양양|평창|원주|강원/, 32], [/전주|군산|익산|전북/, 37], [/여수|순천|목포|광양|전남/, 38],
  [/경주|포항|안동|구미|경북/, 35], [/창원|김해|진주|통영|거제|경남/, 36], [/청주|충북/, 33], [/천안|아산|공주|보령|충남/, 34],
];
// 주소 앞쪽에 먼저 나오는 시·도 이름을 고른다 ('부산 해운대구'의 '대구', '경기 광주시'의 '광주'에 속지 않도록)
const areaFromText = t => {
  const s = t || '';
  let best = 0, at = Infinity;
  for (const [n, c] of AREA_BY_NAME) { const i = s.indexOf(n); if (i >= 0 && i < at) { at = i; best = c; } }
  if (best) return best;
  for (const [re, c] of VENUE_HINTS) if (re.test(s)) return c;
  return 0;
};

function classify(title, realm, fallback = 'fest') {
  const t = `${title || ''} ${realm || ''}`;
  if (/전시|展|갤러리|미술|아트페어|비엔날레|사진전|기획전|특별전|박람회|엑스포|expo|exhibition|페어|fair|쇼\b|show\b|대전\b/i.test(t)) return 'expo';
  if (/축제|페스티벌|페스타|festival|fest\b|불꽃|장터|마켓|빛축제|등축제/i.test(t)) return 'fest';
  if (/연극|뮤지컬|오페라|무용|발레|콘서트|음악|국악|공연|리사이틀|연주회|극장|concert/i.test(t)) return 'show';
  return fallback;
}
// 'YY.MM.DD' 또는 'YYYY.MM.DD' → 'YYYYMMDD'
const ymdLoose = s => { const d = (s || '').replace(/\D/g, ''); return d.length === 6 ? '20' + d : d.slice(0, 8); };
const decodeEntities = s => (s || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&(lsquo|rsquo|ldquo|rdquo|middot|hellip|ndash|mdash|bull|times|deg|rarr|larr);/g, (_, k) => ({ lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', hellip: '…', ndash: '–', mdash: '—', bull: '•', times: '×', deg: '°', rarr: '→', larr: '←' }[k]));
const text = s => decodeEntities((s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const digits = s => (s || '').replace(/\D/g, '').slice(0, 8);
// 카드에 보여줄 한 줄 설명: 태그 제거 후 앞부분만
const clip = (s, n = 140) => { const t = text((s || '').replace(/<br\s*\/?>/gi, ' ')); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };
// 동시 요청 수를 제한해 상세 페이지를 순회 (실패는 무시)
async function mapPool(items, size, fn, label = '') {
  let i = 0, fail = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const it = items[i++]; try { await fn(it); } catch { fail++; } }
  }));
  if (label) console.log(`[${label}] 상세 ${items.length}건 중 실패 ${fail}건`);
  return fail;
}

async function get(url, opts = {}) {
  // 네트워크 오류나 5xx 는 최대 3번 재시도 (공공데이터포털 게이트웨이가 가끔 연결을 끊는다)
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko' }, redirect: 'follow', signal: AbortSignal.timeout(60000), ...opts });
      if (res.status >= 500) throw new Error(`${res.status} ${url}`);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const why = body.match(/<returnAuthMsg>([^<]+)|"returnAuthMsg"\s*:\s*"([^"]+)"|<errMsg>([^<]+)/);
        throw Object.assign(new Error(`${res.status} ${why ? (why[1] || why[2] || why[3]) : ''} ${url.split('?')[0]}`.trim()), { noRetry: true });
      }
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (e.noRetry) throw e;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}


export { UA, GW, today, pad, ymd, addDays, dashed, dotted, TODAY, HORIZON, AREA_BY_NAME, VENUE_HINTS, areaFromText, classify, ymdLoose, decodeEntities, text, digits, clip, mapPool, get };
