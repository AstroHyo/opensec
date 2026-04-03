# OpenSec

OpenSec는 Telegram DM과 OpenClaw 오케스트레이션을 전제로 만든 개인용 AI 뉴스 브리핑 시스템입니다.

이 저장소의 핵심 아이디어는 단순합니다.

- 뉴스 수집과 후보 선정은 deterministic pipeline이 맡습니다.
- LLM은 선택적 enrichment, explanation, research layer로만 붙습니다.
- 모델이 없어도 usable한 digest를 계속 보낼 수 있어야 합니다.

현재 저장소는 두 가지를 함께 제공합니다.

1. `news-bot/`: 실제 뉴스 브리핑 엔진
2. `skills/` + `workspace-template/`: OpenClaw 개인 워크스페이스와 Telegram DM 운영을 위한 자산

## Why OpenSec

이 프로젝트는 "모델이 그때그때 웹을 돌아다니며 알아서 고르는 뉴스 봇"을 지향하지 않습니다.

대신 아래 원칙을 지킵니다.

- curated source만 수집합니다.
- canonical URL, source label, source links, score reasons 같은 evidence를 보존합니다.
- official source가 commentary보다 우선합니다.
- silence is better than low-signal filler를 기본값으로 둡니다.
- daily digest는 live browsing이 없어도 계속 생성되어야 합니다.

이 구조 덕분에 재현 가능성, 디버깅 가능성, 로컬 fallback, 후속 질의의 근거 추적성을 유지할 수 있습니다.

## Current Status

지금 기준으로 이미 구현된 범위는 다음과 같습니다.

- curated source fetch
- normalization, canonicalization, dedupe
- SQLite 기반 상태 저장
- deterministic scoring과 resend suppression
- 한국어 Telegram digest 렌더링
- 저장된 digest context 기반 follow-up command
- 선택적 LLM item enrichment와 theme synthesis
- `ask` 기반 stored-evidence explanation
- `research` 기반 opt-in live research with citations
- OpenClaw 개인 워크스페이스 부트스트랩과 Telegram DM skill 세트

아직 완전히 구현되지 않았거나 앞으로 확장될 여지가 있는 부분도 있습니다.

- LLM rerank calibration
- richer Telegram inline UX
- 운영 자동화와 VPS rollout polishing

## Architecture

현재 시스템의 큰 흐름은 아래와 같습니다.

```text
Curated Sources
  -> source adapters
  -> normalization + canonicalization
  -> dedupe + merge
  -> SQLite state
  -> deterministic scoring
  -> shortlist selection
  -> optional LLM enrichment
  -> Korean digest rendering
  -> follow-up commands / Telegram delivery
```

조금 더 구체적으로 보면:

1. `news-bot/src/sources/`가 curated source를 fetch합니다.
2. `news-bot/src/util/`과 `news-bot/src/db.ts`가 normalize, dedupe, persistence를 담당합니다.
3. `news-bot/src/scoring.ts`가 explicit rule 기반으로 후보를 정렬합니다.
4. `news-bot/src/digest/`가 digest item과 Telegram text를 조립합니다.
5. `news-bot/src/llm/`은 optional하게 summary/theme/research를 보강합니다.
6. `news-bot/src/commands/`가 digest 실행과 follow-up UX를 제공합니다.

중요한 boundary는 변하지 않습니다.

- daily digest는 deterministic retrieval과 scoring이 system of record입니다.
- LLM은 이미 뽑힌 bounded candidate set 위에서만 동작해야 합니다.
- article content는 untrusted input으로 취급합니다.
- enrichment failure는 digest delivery를 막으면 안 됩니다.

## Supported Sources And Outputs

현재 기본 source 어댑터는 아래를 다룹니다.

- GeekNews RSS
- OpenAI News RSS
- GitHub Trending
  - overall
  - python
  - typescript
  - javascript
  - rust

현재 제공하는 주요 출력은 아래와 같습니다.

- AM digest
- PM digest
- `openai only`
- `repo radar`
- `expand N`
- `show sources for N`
- `why important N`
- `today themes`
- `ask <질문>`
- `research <질문>`

## Repository Map

| Path | Purpose |
| --- | --- |
| `news-bot/` | 뉴스 수집, 저장, 점수화, digest 생성, follow-up 처리까지 포함한 product engine |
| `skills/` | OpenClaw에서 재사용할 workspace skill 세트 |
| `docs/design-docs/` | 장기적인 설계 원칙과 architecture belief |
| `docs/product-specs/` | 사용자 관점의 동작 명세 |
| `docs/exec-plans/` | 진행 중이거나 완료된 실행 계획 |
| `docs/generated/` | DB schema 같은 파생 문서 |
| `scripts/` | 워크스페이스 bootstrap 및 운영 스크립트 |
| `workspace-template/` | 개인 OpenClaw workspace의 기본 scaffold |

루트 구조를 간단히 보면 다음과 같습니다.

```text
OpenSec/
├── AGENTS.md
├── ARCHITECTURE.md
├── docs/
├── news-bot/
├── scripts/
├── skills/
└── workspace-template/
```

## Quick Start

### 1. News Bot만 먼저 실행해보기

```bash
cd ./news-bot
pnpm install
pnpm approve-builds
cp .env.example .env
pnpm test
pnpm digest:am
pnpm followup -- "expand 1"
```

`pnpm approve-builds`에서는 보통 `better-sqlite3`와 `esbuild`를 허용하면 됩니다.

필수 환경 변수:

- `NEWS_BOT_TELEGRAM_USER_ID`
- `TELEGRAM_BOT_TOKEN`

선택 환경 변수:

- `OPENAI_API_KEY`
- `NEWS_BOT_LLM_ENABLED`
- `NEWS_BOT_LLM_THEMES_ENABLED`
- `NEWS_BOT_LLM_MODEL_SUMMARY`
- `NEWS_BOT_LLM_MODEL_THEMES`
- `NEWS_BOT_LLM_MODEL_RESEARCH`

빠른 검증용 명령:

```bash
pnpm --dir ./news-bot test
pnpm --dir ./news-bot dry-run:am
pnpm --dir ./news-bot dry-run:pm
```

### 2. OpenClaw 개인 워크스페이스까지 붙이기

Telegram DM을 개인 control plane처럼 쓰고 싶다면 아래 자산을 함께 사용하면 됩니다.

- `openclaw.personal.example.jsonc`
- `scripts/setup-personal-workspace.sh`
- `workspace-template/`
- `skills/ai_news_brief/`
- `skills/code_ops/`
- `skills/repo_ops/`
- `skills/system_ops/`

기본 bootstrap:

```bash
bash ./scripts/setup-personal-workspace.sh
```

그 다음:

1. `openclaw.personal.example.jsonc`를 기반으로 OpenClaw 설정을 복사합니다.
2. Telegram bot token과 owner user ID를 채웁니다.
3. OpenClaw gateway를 붙입니다.
4. OpenClaw가 이 repo의 `skills/`를 읽을 수 있는 workspace에서 실행되도록 맞춥니다.

## Core Commands

`news-bot/package.json` 기준으로 자주 쓰는 명령은 아래와 같습니다.

```bash
pnpm --dir ./news-bot fetch
pnpm --dir ./news-bot digest:am
pnpm --dir ./news-bot digest:pm
pnpm --dir ./news-bot followup -- "show sources for 2"
pnpm --dir ./news-bot followup -- "ask 오늘 OpenAI 뉴스만 다시 요약해줘"
pnpm --dir ./news-bot followup -- "research 2번 뉴스 관련 최신 공식 반응까지 찾아줘"
```

## Who This Repo Is For

이 저장소는 특히 아래 사람들에게 맞습니다.

- 개인용 AI 뉴스 digest를 Telegram으로 받고 싶은 운영자
- OpenClaw를 "개인 DM control plane"처럼 쓰고 싶은 사용자
- deterministic retrieval과 optional LLM enrichment를 함께 설계하고 싶은 기여자
- 뉴스 큐레이션보다 evidence preservation과 explainability를 더 중요하게 보는 팀

반대로 아래와는 거리가 있습니다.

- unconstrained autonomous browsing bot을 바로 만들고 싶은 경우
- multi-tenant SaaS newsroom 제품을 당장 만들려는 경우
- source curation 없이 모델이 알아서 선택하게 두고 싶은 경우

## Docs Guide

처음 읽는 순서는 아래를 권장합니다.

1. [`ARCHITECTURE.md`](./ARCHITECTURE.md)
2. [`news-bot/README.md`](./news-bot/README.md)
3. [`docs/generated/db-schema.md`](./docs/generated/db-schema.md)
4. [`docs/product-specs/llm-assisted-digest.md`](./docs/product-specs/llm-assisted-digest.md)
5. [`docs/product-specs/telegram-news-followup-and-research.md`](./docs/product-specs/telegram-news-followup-and-research.md)
6. [`docs/design-docs/openclaw-personal-control-plane.md`](./docs/design-docs/openclaw-personal-control-plane.md)

현재 진행 중인 주요 계획은 `docs/exec-plans/active/` 아래에 있습니다.

## Contributing

컨트리뷰션 전에 꼭 공유하고 싶은 working agreement는 아래와 같습니다.

- daily digest generation을 freeform live web search에 의존하게 만들지 않습니다.
- LLM은 deterministic retrieval 위에 올라가는 optional layer로 유지합니다.
- non-LLM fallback path를 반드시 남깁니다.
- canonical URL, source labels, source link list, score reasons를 보존합니다.
- official sources를 commentary보다 우선합니다.

의미 있는 architecture change라면 아래까지 같이 업데이트해야 합니다.

1. `ARCHITECTURE.md`
2. `docs/exec-plans/active/` 아래 execution plan
3. `docs/generated/db-schema.md`
4. ranking, rendering, follow-up 변화에 대한 테스트

기여 전후에 추천하는 검증 명령:

```bash
pnpm --dir ./news-bot test
pnpm --dir ./news-bot digest:am
pnpm --dir ./news-bot digest:pm
```

## Project Direction

OpenSec는 뉴스 digest bot 하나로 끝나는 저장소가 아니라, "deterministic information pipeline + personal Telegram control plane"이라는 더 큰 방향을 향하고 있습니다.

즉:

- `news-bot/`은 제품 엔진이고,
- `skills/`와 `workspace-template/`은 운영 인터페이스이며,
- `docs/`는 앞으로의 판단 기준을 보존하는 장기 기억입니다.

이 저장소를 사용하든 기여하든, 가장 중요한 기준은 같습니다.

정확한 source grounding을 잃지 않으면서도, 점점 더 쓰기 쉬운 개인용 AI workflow로 발전시키는 것.
