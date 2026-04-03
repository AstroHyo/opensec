<div align="center">

# OpenSec

**Telegram과 OpenClaw를 위한 deterministic AI 뉴스 브리핑 시스템**

Curated source를 수집하고, 로컬 상태를 기준으로 우선순위를 정하고, 한국어 digest를 만들고, 필요할 때만 LLM을 설명 레이어로 붙입니다.

[English README](./README.md) • [아키텍처](./ARCHITECTURE.md) • [뉴스 엔진](./news-bot/README.md) • [DB 스키마](./docs/generated/db-schema.md)

</div>

## OpenSec는 무엇이 다른가

OpenSec의 핵심 원칙은 분명합니다.

> daily digest는 모델의 자유 탐색이 아니라 deterministic retrieval과 scoring에서 나와야 합니다.

이 원칙 덕분에 다음을 지킬 수 있습니다.

- 재현 가능한 ranking
- 디버깅 가능한 로컬 상태
- source attribution과 evidence 보존
- 안전한 non-LLM fallback
- 저장된 digest context에 근거한 follow-up

LLM이 있으면 설명 품질이 좋아지고, 없어도 digest는 계속 나가야 합니다.

## 핵심 특징

| 기능 | 의미 |
| --- | --- |
| Deterministic daily digest | curated source, normalization, dedupe, SQLite state, explicit scoring |
| Evidence preservation | canonical URL, source label, source links, score reasons를 유지 |
| Korean Telegram output | 모바일 Telegram에서 빠르게 읽히는 한국어 digest |
| Optional LLM layer | item enrichment, theme synthesis, ask, research |
| Private control plane support | OpenClaw workspace 자산과 Telegram DM 운영 흐름 포함 |

## 작동 원리

```mermaid
flowchart LR
    A["Curated sources"] --> B["Source adapters"]
    B --> C["Normalize and canonicalize"]
    C --> D["Deduplicate and merge"]
    D --> E[("SQLite state")]
    E --> F["Deterministic scoring"]
    F --> G["Digest shortlist"]
    G --> H["Telegram digest renderer"]
    G --> I["Optional LLM enrichment"]
    I --> H
    H --> J["Telegram or shell output"]
    E --> K["Stored follow-up context"]
    K --> L["Deterministic follow-up"]
    K --> M["Ask mode"]
    K --> N["Research mode"]
```

중요한 경계는 LLM의 위치입니다.

- retrieval은 deterministic하게 유지합니다.
- candidate generation은 bounded set으로 제한합니다.
- enrichment는 scoring 이후에만 붙습니다.
- enrichment 실패가 delivery를 막으면 안 됩니다.

## 전체 아키텍처

```mermaid
flowchart TB
    subgraph Sources["Curated inputs"]
        S1["GeekNews RSS"]
        S2["OpenAI News RSS"]
        S3["GitHub Trending"]
    end

    subgraph Engine["news-bot/"]
        SA["src/sources/"]
        U["src/util/"]
        DB["src/db.ts + SQLite"]
        SC["src/scoring.ts"]
        DG["src/digest/"]
        CM["src/commands/"]
        LLM["src/llm/ (optional)"]
    end

    subgraph Control["Telegram / OpenClaw layer"]
        SK["skills/"]
        WS["workspace-template/"]
        OC["OpenClaw orchestration"]
        TG["Telegram DM"]
    end

    S1 --> SA
    S2 --> SA
    S3 --> SA
    SA --> U
    U --> DB
    DB --> SC
    SC --> DG
    SC --> LLM
    LLM --> DG
    DB --> CM
    DG --> CM
    CM --> OC
    SK --> OC
    WS --> OC
    OC --> TG
```

## 현재 구현된 범위

이미 포함된 기능:

- curated source ingestion
- normalization, canonicalization, deduplication
- SQLite 기반 상태 저장
- deterministic ranking과 resend suppression
- 한국어 digest 렌더링
- 저장된 context 기반 follow-up command
- optional LLM item enrichment와 theme synthesis
- stored evidence 기반 `ask`
- bounded live search와 cited links를 사용하는 `research`
- OpenClaw 개인 워크스페이스 bootstrap 자산

아직 확장 중이거나 계획된 영역:

- LLM rerank calibration
- richer Telegram inline actions
- VPS 및 운영 자동화 고도화

## 지원 소스

기본 adapter는 현재 아래를 지원합니다.

- GeekNews RSS
- OpenAI News RSS
- GitHub Trending
  - overall
  - python
  - typescript
  - javascript
  - rust

## Follow-up 모드

| 모드 | 예시 | 설명 |
| --- | --- | --- |
| Deterministic | `openai only` | 최신 digest context에서 OpenAI 관련 항목만 보여줌 |
| Deterministic | `repo radar` | 저장된 digest context에서 repo 중심 항목을 보여줌 |
| Deterministic | `today themes` | 최신 저장 theme bullet을 반환 |
| Deterministic | `expand 2` | 최신 저장 digest만 사용 |
| Deterministic | `show sources for 2` | 저장된 evidence 링크를 반환 |
| Deterministic | `why important 2` | 저장된 score reasoning 설명 |
| Ask | `ask 오늘 OpenAI 항목만 다시 요약해줘` | 저장된 digest evidence를 사용하고, 가능하면 LLM으로 설명을 보강 |
| Research | `research 2번 항목을 더 깊게 조사해줘` | 명시적 요청일 때만 live research와 cited links 사용 |

## 저장소 구조

| 경로 | 역할 |
| --- | --- |
| `news-bot/` | 수집, 저장, 점수화, digest 생성, follow-up 처리까지 담당하는 product engine |
| `skills/` | OpenClaw에서 사용하는 workspace skill |
| `docs/design-docs/` | 장기적인 설계 원칙과 architecture note |
| `docs/product-specs/` | 사용자 관점의 동작 명세 |
| `docs/exec-plans/` | active / completed execution plan |
| `docs/generated/` | DB schema 같은 파생 문서 |
| `scripts/` | workspace bootstrap 및 운영 스크립트 |
| `workspace-template/` | OpenClaw 개인 workspace 기본 scaffold |

## 빠른 시작

### 1. 뉴스 엔진 로컬 실행

```bash
cd ./news-bot
pnpm install
pnpm approve-builds
cp .env.example .env
pnpm test
pnpm digest:am
pnpm followup -- "expand 1"
```

`pnpm approve-builds`에서 native package 허용이 필요하면 `better-sqlite3`와 `esbuild`를 승인하면 됩니다.

자주 쓰는 명령:

```bash
pnpm --dir ./news-bot fetch
pnpm --dir ./news-bot digest:am
pnpm --dir ./news-bot digest:pm
pnpm --dir ./news-bot dry-run:am
pnpm --dir ./news-bot dry-run:pm
pnpm --dir ./news-bot followup -- "openai only"
pnpm --dir ./news-bot followup -- "repo radar"
pnpm --dir ./news-bot followup -- "today themes"
pnpm --dir ./news-bot followup -- "show sources for 2"
pnpm --dir ./news-bot followup -- "ask 오늘 OpenAI 항목만 다시 요약해줘"
pnpm --dir ./news-bot followup -- "research 2번 항목을 더 깊게 조사해줘"
```

### 2. 환경 변수 설정

로컬 CLI 확인만 할 때는 기본값만으로도 시작할 수 있습니다.

실제 Telegram / OpenClaw delivery를 붙이려면 아래 값을 채워야 합니다.

- `NEWS_BOT_TELEGRAM_USER_ID`
- `TELEGRAM_BOT_TOKEN`

선택적 LLM 관련 변수:

- `OPENAI_API_KEY`
- `NEWS_BOT_LLM_ENABLED`
- `NEWS_BOT_LLM_THEMES_ENABLED`
- `NEWS_BOT_LLM_MODEL_SUMMARY`
- `NEWS_BOT_LLM_MODEL_THEMES`
- `NEWS_BOT_LLM_MODEL_RESEARCH`

### 3. 개인 Telegram control plane으로 확장

이 저장소에는 OpenSec를 private OpenClaw workspace 안에서 운영하기 위한 자산도 들어 있습니다.

주요 파일:

- [`openclaw.personal.example.jsonc`](./openclaw.personal.example.jsonc)
- [`scripts/setup-personal-workspace.sh`](./scripts/setup-personal-workspace.sh)
- [`workspace-template/`](./workspace-template)
- [`skills/ai_news_brief/`](./skills/ai_news_brief)
- [`skills/code_ops/`](./skills/code_ops)
- [`skills/repo_ops/`](./skills/repo_ops)
- [`skills/system_ops/`](./skills/system_ops)

기본 bootstrap:

```bash
bash ./scripts/setup-personal-workspace.sh
```

그 다음:

1. OpenClaw 설정 예제를 복사합니다.
2. Telegram bot token과 owner ID를 채웁니다.
3. OpenClaw gateway를 실행합니다.
4. 이 skill들을 포함한 personal workspace를 OpenClaw가 보도록 연결합니다.

## 디자인 원칙

이 저장소의 non-negotiable은 아래와 같습니다.

- daily digest generation을 freeform live web search에 의존하게 만들지 않는다
- LLM은 deterministic retrieval 아래가 아니라 그 위의 optional layer로 둔다
- non-LLM fallback path를 항상 남긴다
- original evidence와 scoring context를 보존한다
- official source를 commentary보다 우선한다
- filler보다 silence를 선택한다

## 문서 가이드

처음 읽는 순서는 아래를 추천합니다.

1. [`ARCHITECTURE.md`](./ARCHITECTURE.md)
2. [`news-bot/README.md`](./news-bot/README.md)
3. [`docs/generated/db-schema.md`](./docs/generated/db-schema.md)
4. [`docs/product-specs/llm-assisted-digest.md`](./docs/product-specs/llm-assisted-digest.md)
5. [`docs/product-specs/telegram-news-followup-and-research.md`](./docs/product-specs/telegram-news-followup-and-research.md)
6. [`docs/design-docs/openclaw-personal-control-plane.md`](./docs/design-docs/openclaw-personal-control-plane.md)

현재 진행 중인 작업은 [`docs/exec-plans/active/`](./docs/exec-plans/active) 아래에 있습니다.

## 컨트리뷰팅

기여할 때의 가장 짧고 정확한 mental model은 이렇습니다.

- `news-bot/`은 product engine
- `skills/`와 `workspace-template/`은 operating interface
- `docs/`는 future contributor를 위한 durable memory

의미 있는 architecture change라면 아래를 함께 갱신해야 합니다.

1. [`ARCHITECTURE.md`](./ARCHITECTURE.md)
2. 관련 execution plan 문서
3. schema가 바뀌었다면 [`docs/generated/db-schema.md`](./docs/generated/db-schema.md)
4. ranking, rendering, follow-up behavior 테스트

추천 검증 명령:

```bash
pnpm --dir ./news-bot test
pnpm --dir ./news-bot digest:am
pnpm --dir ./news-bot digest:pm
```

## 이 저장소가 잘 맞는 경우

OpenSec는 아래와 잘 맞습니다.

- 1인 소유자의 private AI news digest가 필요할 때
- Telegram을 primary front door로 쓰고 싶을 때
- deterministic retrieval 위에 optional LLM explanation을 얹고 싶을 때
- opaque agent behavior보다 preserved evidence를 중요하게 볼 때
- product code와 operations scaffold를 한 repo에서 같이 관리하고 싶을 때

아래와는 거리가 있습니다.

- fully autonomous browsing-first agent
- multi-tenant SaaS productization
- evidence trail 없는 model-only ranking
