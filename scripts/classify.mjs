// AI 분류기: 수집된 행사에 종류·장르·주제를 Claude 가 매긴다.
// 수집(collect.mjs)은 코드로, 분류는 AI 로. 결과는 events.json 의 각 항목 `ai` 칸에 저장되고
// 다음 수집 때 id 기준으로 그대로 이어지므로, 매일 새로 들어온 행사만 분류한다.
//
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/classify.mjs
//   AI_MODEL=claude-haiku-5-5 node scripts/classify.mjs   # 모델 바꾸기 (기본 claude-opus-5-5)
//   AI_LIMIT=200 node scripts/classify.mjs                 # 한 번에 최대 N 건만 (기본 2000)
//   AI_FORCE=1 node scripts/classify.mjs                   # 이미 분류된 것도 다시
//
// 분류 체계(TAXONOMY)가 바뀌면 VERSION 을 올린다. 그러면 전부 다시 분류한다.
// 키가 없으면 아무것도 하지 않고 끝나므로, 페이지는 ai 가 없는 항목에 규칙 분류를 쓴다.

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const OUT = new URL('../festivals/data/events.json', import.meta.url);
const KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const LIMIT = Number(process.env.AI_LIMIT || 4000); // 출처를 늘리면 첫날 새 행사가 수천 건이라 넉넉히
const FORCE = !!process.env.AI_FORCE;
const BATCH = 20; // 항목당 출력이 늘어 배치를 줄인다
export const VERSION = 4;

export const TAXONOMY = {
  kind: {
    fest: '축제 (지역 축제, 페스티벌, 불꽃놀이, 마라톤·걷기 행사, 야간개장 같은 야외 이벤트)',
    expo: '전시 (미술·사진·미디어아트·캐릭터·기획전 등 관람하는 전시)',
    fair: '박람회 (산업전, 엑스포, 페어, 컨벤션, 학술대회, 채용·창업·웨딩·베이비 박람회처럼 부스를 둘러보는 행사)',
    show: '공연 (연극, 뮤지컬, 콘서트, 클래식, 국악, 무용 등 객석에서 보는 공연)',
    popup: '팝업 (팝업스토어, 브랜드 체험관)',
    edu: '체험·교육 (강좌, 클래스, 워크숍, 교육 프로그램, 투어, 해설, 의식 재현처럼 참여하는 프로그램)',
    sport: '스포츠 (프로야구·축구·농구·배구 경기, e스포츠 리그 경기처럼 관람석에서 보는 경기. 마라톤처럼 직접 참가하는 대회는 fest)',
  },
  genre: ['뮤지컬·오페라', '연극', '콘서트', '클래식', '국악·전통', '무용·발레', '아동·가족', '기타'],
  topics: [
    '회화·조각', '사진', '미디어아트·몰입형', '캐릭터·애니·웹툰', '디자인·건축', '공예·도자', '패션·뷰티',
    '역사·문화유산', '전통·민속', '자연·꽃·정원', '음악', '영화·영상', '먹거리·특산물', '커피·술·디저트',
    '빛·불꽃·드론', '산업·기술', '비즈니스·창업·채용', '리빙·인테리어', '반려동물', '웨딩·출산·육아',
    '책·문학·인문', '과학·우주·환경', '키즈·가족', '스포츠·레저·캠핑', '게임·e스포츠', '건강·웰니스',
    '마켓·플리마켓', '야간·야행', '자동차·모빌리티', '여행·관광',
  ],
  // 아래는 검색·추천용 부가 정보 (데이트 코스, 효도 여행, 분야별 글쓰기 등 다른 프로그램에서 쓰기 위한 것)
  who: ['연인·데이트', '가족·아이', '부모님·효도', '친구', '혼자', '외국인', '반려동물 동반', '비즈니스·전문가'],
  age: ['유아', '어린이', '청소년', '20대', '30대', '40대', '50대', '60대 이상'],
  mood: ['로맨틱', '힐링·여유', '활기찬·신나는', '감성·예술', '교육·배움', '트렌디·핫플', '전통·고즈넉', '럭셔리', '가성비'],
  setting: ['실내', '야외', '실내외'],
  time: ['낮', '밤', '낮·밤'],
  cost: ['무료', '1만원 이하', '1~3만원', '3만원 이상', '미상'],
  stay: ['1시간 이내', '2~3시간', '반나절', '하루 이상'],
};

const SYSTEM = `당신은 한국의 전시·축제·공연·팝업 행사 정보를 분류하는 사서입니다. 각 행사에 대해 다음을 정합니다.

1. kind (하나): ${Object.entries(TAXONOMY.kind).map(([k, v]) => `${k} = ${v}`).join(' / ')}
2. genre: kind 가 show 일 때만 ${TAXONOMY.genre.join(', ')} 중 하나. 공연이 아니면 빈 문자열.
3. topics: ${TAXONOMY.topics.join(', ')} 중 0~4개. 행사의 내용·분야를 나타내는 것만 고르고, 억지로 붙이지 않습니다. 여러 분야에 걸치면 모두 붙입니다 (예: 사진 전시 → 사진 + 회화·조각은 아님, 공룡 미디어아트 → 미디어아트·몰입형 + 키즈·가족 + 과학·우주·환경).
   - 공연에는 '음악'을 붙이지 않습니다 (장르로 충분합니다). 국악 공연은 '전통·민속', 아동 공연은 '키즈·가족'처럼 내용이 뚜렷할 때만 붙입니다.
   - 회화·조각 = 그림·조각·설치 등 순수미술 전시. 사진 = 사진전. 미디어아트·몰입형 = 빛·영상·VR·인터랙티브 체험형 전시.
   - 역사·문화유산 = 박물관·유물·궁궐·근대사. 전통·민속 = 국악·민속놀이·한복·한옥·세시풍속·제례.
   - 산업·기술 = 반도체·로봇·AI·에너지·건설·의료기기 같은 산업·기술 박람회. 비즈니스·창업·채용 = 창업·채용·프랜차이즈·수출상담·학술·컨퍼런스. 자동차·모빌리티 = 자동차·오토살롱·전기차·항공.
   - 리빙·인테리어 = 가구·인테리어·주방·가전·홈 팝업. 웨딩·출산·육아 = 웨딩·베이비·맘앤베이비·유아교육 박람회. 패션·뷰티 = 의류·신발·화장품·헤어. 반려동물 = 펫 박람회·반려동물 축제. 건강·웰니스 = 건강·헬스·실버·명상·요가·의료 상담.
   - 먹거리·특산물 = 음식·특산물(사과·유자·한우·수산 등) 축제·푸드 박람회. 커피·술·디저트 = 카페쇼·커피·와인·막걸리·맥주·디저트·베이커리.
   - 꽃·단풍·억새·정원·숲·바다·섬 축제는 '자연·꽃·정원', 야행·빛·드론쇼·불꽃·등축제는 '빛·불꽃·드론', 야간개장·밤에 여는 행사는 '야간·야행'(빛 행사와 겹치면 둘 다).
   - 영화제·상영회는 '영화·영상', 도서전·북토크·문학·인문학 강좌는 '책·문학·인문', 과학축전·천문·우주·환경·생태는 '과학·우주·환경'.
   - 마라톤·걷기·캠핑·아웃도어·레저는 '스포츠·레저·캠핑', 게임·e스포츠·보드게임·카드게임은 '게임·e스포츠', 플리마켓·아트마켓·장터·바자회는 '마켓·플리마켓', 여행 박람회·관광 행사는 '여행·관광'.

4. who: 이 행사가 잘 맞는 동행 유형. ${TAXONOMY.who.join(', ')} 중 1~4개. 실제로 어울리는 것만 고릅니다. 반도체·건설·의료기기·채용·수출상담처럼 산업·비즈니스 성격의 박람회·컨퍼런스에는 '연인·데이트'와 '로맨틱'을 절대 붙이지 않고 '비즈니스·전문가'를 씁니다 (카페쇼·웨딩·펫·아트페어처럼 일반 관람객이 가는 박람회는 예외).
5. age: 즐기기 좋은 연령대. ${TAXONOMY.age.join(', ')} 중 1~5개. 어린이 대상이면 유아·어린이, 성인 전시·공연이면 20~50대처럼 폭넓게.
6. mood: 분위기. ${TAXONOMY.mood.join(', ')} 중 1~3개.
7. setting: ${TAXONOMY.setting.join(' / ')} 중 하나. time: 주로 즐기는 시간대, ${TAXONOMY.time.join(' / ')} 중 하나 (야행·불꽃·야간개장은 밤).
8. cost: 1인 입장료 수준, ${TAXONOMY.cost.join(' / ')} 중 하나. 요금 정보가 있으면 그것을 쓰고, 공공 축제·거리 행사는 대개 무료, 티켓 판매 공연·상업 전시는 가격을 모르면 미상.
9. stay: 보통 머무는 시간, ${TAXONOMY.stay.join(' / ')} 중 하나.
10. blurb: 행사를 한 줄로 소개하는 문장 (40~70자, 존댓말 없이 '~하는 전시'처럼 명사형으로 끝냄). 제목을 되풀이하지 말고 무엇을 보고 하는지, 누구에게 좋은지 담습니다.

판단 재료: 제목이 가장 중요하고, 장소·출처·설명·장르힌트는 보조입니다. 출처가 coex/kintex/bexco 면 전시장 행사(대개 박람회), nol/melon 이면 티켓 판매 상품, popply 면 팝업스토어, tour 면 관광공사 축제·행사, ci 면 문화정보원 공연·전시·교육입니다.
입력에 주어진 id 를 그대로 돌려주고, 모든 항목을 빠짐없이 분류합니다.`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: Object.keys(TAXONOMY.kind) },
          genre: { type: 'string', enum: [...TAXONOMY.genre, ''] },
          // 구조화 출력 스키마는 maxItems 를 지원하지 않으므로, 3개 제한은 프롬프트와 저장 시 slice 로 처리
          topics: { type: 'array', items: { type: 'string', enum: TAXONOMY.topics } },
          who: { type: 'array', items: { type: 'string', enum: TAXONOMY.who } },
          age: { type: 'array', items: { type: 'string', enum: TAXONOMY.age } },
          mood: { type: 'array', items: { type: 'string', enum: TAXONOMY.mood } },
          setting: { type: 'string', enum: TAXONOMY.setting },
          time: { type: 'string', enum: TAXONOMY.time },
          cost: { type: 'string', enum: TAXONOMY.cost },
          stay: { type: 'string', enum: TAXONOMY.stay },
          blurb: { type: 'string' },
        },
        required: ['id', 'kind', 'genre', 'topics', 'who', 'age', 'mood', 'setting', 'time', 'cost', 'stay', 'blurb'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

// 모델에 보여줄 한 항목의 요약 (토큰 절약을 위해 짧게)
export function describe(it) {
  return {
    id: it.id,
    title: it.title,
    place: (it.place || '').slice(0, 60),
    src: it.src,
    kindHint: it.kind, // 수집 단계의 1차 판정
    desc: (it.summary || '').slice(0, 200),
    price: (it.price || '').slice(0, 80),
    start: it.start, end: it.end,
  };
}

// 모델 결과를 규칙으로 다듬는다. 산업·비즈니스 성격 행사(소비자용 주제가 하나도 없는 것)에는 '연인·데이트'와 '로맨틱'을 붙이지 않는다.
const CONSUMER_TOPICS = new Set(['회화·조각', '사진', '미디어아트·몰입형', '캐릭터·애니·웹툰', '디자인·건축', '공예·도자', '패션·뷰티', '역사·문화유산', '전통·민속', '자연·꽃·정원', '음악', '영화·영상', '먹거리·특산물', '커피·술·디저트', '빛·불꽃·드론', '리빙·인테리어', '반려동물', '웨딩·출산·육아', '책·문학·인문', '키즈·가족', '스포츠·레저·캠핑', '게임·e스포츠', '건강·웰니스', '마켓·플리마켓', '야간·야행', '여행·관광']);
export function normalize(ai) {
  if (!ai || !ai.who) return ai;
  const industrial = (ai.topics || []).some(t => t === '산업·기술' || t === '비즈니스·창업·채용' || t === '자동차·모빌리티') && !(ai.topics || []).some(t => CONSUMER_TOPICS.has(t));
  if (industrial || ai.who.includes('비즈니스·전문가') && ai.who.length === 1) {
    ai.who = ai.who.filter(w => w !== '연인·데이트');
    ai.mood = (ai.mood || []).filter(m => m !== '로맨틱');
    if (!ai.who.length) ai.who = ['비즈니스·전문가'];
  }
  return ai;
}

export async function classifyBatch(client, items) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: '다음 행사들을 분류하세요.\n' + JSON.stringify(items.map(describe), null, 0) }],
  });
  if (response.stop_reason === 'refusal') throw new Error('모델이 요청을 거부함: ' + (response.stop_details?.category || ''));
  if (response.stop_reason === 'max_tokens') throw new Error('응답이 잘림 (max_tokens)');
  const text = response.content.find(b => b.type === 'text')?.text || '';
  const parsed = JSON.parse(text);
  return { results: parsed.items, usage: response.usage };
}

function needsAi(it) {
  return FORCE || !it.ai || it.ai.v !== VERSION;
}

async function main() {
  const data = JSON.parse(await readFile(OUT, 'utf8'));
  let fixed = 0;
  for (const it of data.items) { if (!it.ai?.who) continue; const before = JSON.stringify([it.ai.who, it.ai.mood]); normalize(it.ai); if (JSON.stringify([it.ai.who, it.ai.mood]) !== before) fixed++; }
  if (fixed) { console.log(`AI 분류 규칙 보정: ${fixed}건`); await writeFile(OUT, JSON.stringify(data, null, 0) + '\n'); }
  const todo = data.items.filter(needsAi).slice(0, LIMIT);
  if (!todo.length) { console.log('AI 분류: 새로 분류할 항목 없음'); return; }
  if (!KEY) { console.log(`AI 분류: ANTHROPIC_API_KEY 없음, ${todo.length}건 건너뜀 (규칙 분류 사용)`); return; }

  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); Anthropic = Anthropic.default || Anthropic; }
  catch { console.error('AI 분류: @anthropic-ai/sdk 미설치 (npm i @anthropic-ai/sdk)'); process.exit(1); }
  const client = new Anthropic({ apiKey: KEY, maxRetries: 6 }); // 동시 요청으로 429 가 나면 SDK 가 물러섰다 다시 보낸다

  const byId = new Map(data.items.map(it => [it.id, it]));
  let done = 0, failed = 0, inTok = 0, outTok = 0, cacheRead = 0, stop = false;
  const batches = []; for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  // 전체 재분류(수천 건)는 한 배치씩 돌리면 두 시간 가까이 걸리므로 몇 개를 동시에 보낸다 (AI_PARALLEL, 기본 4)
  let next = 0;
  const worker = async () => { while (next < batches.length && !stop) { const i = next++; await runBatch(batches[i], i); } };
  async function runBatch(batch, bi) {
    try {
      const { results, usage } = await classifyBatch(client, batch);
      inTok += usage.input_tokens || 0; outTok += usage.output_tokens || 0; cacheRead += usage.cache_read_input_tokens || 0;
      for (const r of results) {
        const it = byId.get(r.id);
        if (!it) continue;
        const uniq = (a, n) => [...new Set((a || []).map(x => String(x).trim()).filter(Boolean))].slice(0, n);
        it.ai = {
          v: VERSION, kind: r.kind, genre: r.kind === 'show' ? (r.genre || '기타') : '', topics: uniq(r.topics, 4),
          who: uniq(r.who, 4), age: uniq(r.age, 5), mood: uniq(r.mood, 3),
          setting: r.setting, time: r.time, cost: r.cost, stay: r.stay,
          blurb: (r.blurb || '').trim().slice(0, 90),
        };
        normalize(it.ai);
        done++;
      }
      const missing = batch.filter(it => !results.some(r => r.id === it.id)).length;
      if (missing) console.warn(`  배치 ${bi + 1}: ${missing}건 응답 누락`);
    } catch (e) {
      failed += batch.length;
      const msg = e instanceof Anthropic.RateLimitError ? '요청 한도 초과' : e instanceof Anthropic.AuthenticationError ? 'API 키가 올바르지 않음' : e instanceof Anthropic.APIError ? `API 오류 ${e.status}: ${e.message}` : e.message;
      console.error(`  배치 ${bi + 1} 실패: ${msg}`);
      if (e instanceof Anthropic.AuthenticationError) stop = true;
    }
  }
  await Promise.all(Array.from({ length: Math.min(Number(process.env.AI_PARALLEL || 4), batches.length) }, worker));
  data.aiClassified = { model: MODEL, version: VERSION, at: new Date().toISOString() };
  await writeFile(OUT, JSON.stringify(data, null, 0) + '\n');
  const remaining = data.items.filter(needsAi).length;
  console.log(`AI 분류 완료: ${done}건 분류, ${failed}건 실패, 남은 미분류 ${remaining}건 | 토큰 입력 ${inTok} (캐시 ${cacheRead}) 출력 ${outTok} | 모델 ${MODEL}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch(e => { console.error(e); process.exit(1); });
}
