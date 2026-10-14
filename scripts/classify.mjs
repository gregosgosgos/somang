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
const LIMIT = Number(process.env.AI_LIMIT || 2000);
const FORCE = !!process.env.AI_FORCE;
const BATCH = 30;
export const VERSION = 1;

export const TAXONOMY = {
  kind: {
    fest: '축제 (지역 축제, 페스티벌, 불꽃놀이, 마라톤·걷기 행사, 야간개장 같은 야외 이벤트)',
    expo: '전시 (미술·사진·미디어아트·캐릭터·기획전 등 관람하는 전시)',
    fair: '박람회 (산업전, 엑스포, 페어, 컨벤션, 학술대회, 채용·창업·웨딩·베이비 박람회처럼 부스를 둘러보는 행사)',
    show: '공연 (연극, 뮤지컬, 콘서트, 클래식, 국악, 무용 등 객석에서 보는 공연)',
    popup: '팝업 (팝업스토어, 브랜드 체험관)',
    edu: '체험·교육 (강좌, 클래스, 워크숍, 교육 프로그램, 투어, 해설, 의식 재현처럼 참여하는 프로그램)',
  },
  genre: ['뮤지컬·오페라', '연극', '콘서트', '클래식', '국악·전통', '무용·발레', '아동·가족', '기타'],
  topics: ['미술·사진·미디어아트', '캐릭터·애니', '디자인·패션·공예', '역사·전통', '자연·꽃', '음악', '영화', '먹거리', '빛·불꽃', '산업·비즈니스', '생활·뷰티·반려', '교육·과학·책', '키즈·가족', '스포츠·레저·게임'],
};

const SYSTEM = `당신은 한국의 전시·축제·공연·팝업 행사 정보를 분류하는 사서입니다. 각 행사에 대해 다음을 정합니다.

1. kind (하나): ${Object.entries(TAXONOMY.kind).map(([k, v]) => `${k} = ${v}`).join(' / ')}
2. genre: kind 가 show 일 때만 ${TAXONOMY.genre.join(', ')} 중 하나. 공연이 아니면 빈 문자열.
3. topics: ${TAXONOMY.topics.join(', ')} 중 0~3개. 행사의 내용·분야를 나타내는 것만 고르고, 억지로 붙이지 않습니다.
   - 공연에는 '음악'을 붙이지 않습니다 (장르로 충분합니다). 국악 공연은 '역사·전통', 아동 공연은 '키즈·가족'처럼 내용이 뚜렷할 때만 붙입니다.
   - 산업 박람회는 '산업·비즈니스', 웨딩·베이비·뷰티·반려동물 박람회는 '생활·뷰티·반려' 입니다.
   - 특산물(사과·유자·커피·맥주 등) 축제는 '먹거리', 꽃·단풍·억새·정원 축제는 '자연·꽃', 야행·빛·드론쇼·불꽃은 '빛·불꽃' 입니다.
   - 영화제·상영회는 '영화' 입니다.

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
        },
        required: ['id', 'kind', 'genre', 'topics'],
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
    desc: (it.summary || '').slice(0, 160),
  };
}

export async function classifyBatch(client, items) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
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
  const todo = data.items.filter(needsAi).slice(0, LIMIT);
  if (!todo.length) { console.log('AI 분류: 새로 분류할 항목 없음'); return; }
  if (!KEY) { console.log(`AI 분류: ANTHROPIC_API_KEY 없음, ${todo.length}건 건너뜀 (규칙 분류 사용)`); return; }

  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); Anthropic = Anthropic.default || Anthropic; }
  catch { console.error('AI 분류: @anthropic-ai/sdk 미설치 (npm i @anthropic-ai/sdk)'); process.exit(1); }
  const client = new Anthropic({ apiKey: KEY });

  const byId = new Map(data.items.map(it => [it.id, it]));
  let done = 0, failed = 0, inTok = 0, outTok = 0, cacheRead = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    try {
      const { results, usage } = await classifyBatch(client, batch);
      inTok += usage.input_tokens || 0; outTok += usage.output_tokens || 0; cacheRead += usage.cache_read_input_tokens || 0;
      for (const r of results) {
        const it = byId.get(r.id);
        if (!it) continue;
        it.ai = { v: VERSION, kind: r.kind, genre: r.kind === 'show' ? (r.genre || '기타') : '', topics: [...new Set(r.topics)].slice(0, 3) };
        done++;
      }
      const missing = batch.filter(it => !results.some(r => r.id === it.id)).length;
      if (missing) console.warn(`  배치 ${i / BATCH + 1}: ${missing}건 응답 누락`);
    } catch (e) {
      failed += batch.length;
      const msg = e instanceof Anthropic.RateLimitError ? '요청 한도 초과' : e instanceof Anthropic.AuthenticationError ? 'API 키가 올바르지 않음' : e instanceof Anthropic.APIError ? `API 오류 ${e.status}: ${e.message}` : e.message;
      console.error(`  배치 ${i / BATCH + 1} 실패: ${msg}`);
      if (e instanceof Anthropic.AuthenticationError) break;
    }
  }
  data.aiClassified = { model: MODEL, version: VERSION, at: new Date().toISOString() };
  await writeFile(OUT, JSON.stringify(data, null, 0) + '\n');
  const remaining = data.items.filter(needsAi).length;
  console.log(`AI 분류 완료: ${done}건 분류, ${failed}건 실패, 남은 미분류 ${remaining}건 | 토큰 입력 ${inTok} (캐시 ${cacheRead}) 출력 ${outTok} | 모델 ${MODEL}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch(e => { console.error(e); process.exit(1); });
}
