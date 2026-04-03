# Telegram News Follow-up And Research

## Purpose

Define the user-visible behavior for Telegram news Q&A after the daily digest has been delivered.

This spec covers two follow-up modes:

- `ask`: natural-language explanation using stored digest evidence
- `research`: opt-in live LLM research using fresh web search plus stored digest context

It does not change the deterministic daily digest pipeline.

## Product Principles

1. Daily digest generation remains deterministic.
2. Natural-language follow-up should feel easier than memorizing commands.
3. Live web research must be explicit and opt-in.
4. Official sources should be preferred over commentary when both exist.
5. Every answer should show what evidence it used.
6. Silence is better than speculative filler.

## Supported User Modes

### Mode 1: Deterministic Follow-up

Use the latest stored digest and follow-up context only.

Examples:

- `expand 2`
- `show sources for 2`
- `why important 2`
- `today themes`

This mode must work without any LLM.

### Mode 2: Ask

Use an LLM to better explain or reframe stored digest evidence without live browsing.

Examples:

- `ask 2번 뉴스 우리 제품 관점에서 설명해줘`
- `ask 오늘 OpenAI 뉴스만 5줄로 요약해줘`
- `ask 1번이랑 2번 차이를 알려줘`

Behavior:

- answer from the latest digest and stored evidence only
- cite which digest items were used
- preserve existing source links and score reasons
- fall back to deterministic summaries if the LLM is unavailable

### Mode 3: Research

Use an LLM plus live search when the user explicitly asks for more research.

Examples:

- `research 2번 뉴스 관련 최신 반응까지 찾아서 정리해줘`
- `research 오늘 OpenAI 소식이 우리한테 어떤 의미인지 더 조사해줘`
- `research Repo Radar 항목 중 제일 중요한 하나를 더 깊게 봐줘`

Behavior:

- start from stored digest context when available
- collect a bounded evidence set from live search
- prefer official and recent sources
- synthesize an answer with explicit links and uncertainty
- if live research fails, return the best bounded answer from stored evidence and say live research was incomplete

## Natural-Language Routing

The Telegram UX should not force the user to memorize command syntax.

The system should route incoming text in this order:

1. exact deterministic commands
2. natural-language variants that map to deterministic commands
3. `ask` mode
4. `research` mode

Examples of auto-mapped natural language:

- `2번 자세히 설명해줘` -> `expand 2`
- `2번 출처 보여줘` -> `show sources for 2`
- `2번 왜 중요해?` -> `why important 2`
- `오늘 흐름 다시 정리해줘` -> `today themes`

## Telegram UX Shape

### Entry Point

The Telegram DM is the main inbox-like surface.

Users should be able to type:

- a short command
- a natural-language question
- a research request

without switching tools or modes manually.

### Menus

Keep Telegram command menus small.

Recommended menu:

- `/brief`
- `/ask`
- `/research`
- `/status`

Most workflows should still work from plain typed messages.

### Inline Actions

Each digest item should eventually support lightweight next-step actions such as:

- `자세히`
- `출처`
- `LLM 설명`
- `더 리서치`

These should be convenience affordances, not the only way to access follow-up.

### Long-Running Research

Research may take longer than normal chat responses.

Recommended flow:

1. acknowledge the request quickly
2. say that research is in progress
3. return the final result in the same Telegram session

If the underlying platform supports tasks/background work cleanly, use that path for longer runs.

## Response Format

### Ask Response

Preferred shape:

1. short answer
2. key points
3. why it matters to the user
4. evidence used

Example footer:

- `근거 항목: 2, 5`
- `출처: OpenAI / Product, GitHub Trending / python`

### Research Response

Preferred shape:

1. one-line conclusion
2. key findings
3. what it means for the user
4. uncertainty or open questions
5. source links

Research answers should always reveal that they used live search.

## Evidence Rules

### Ask

Allowed inputs:

- latest digest items
- stored follow-up context
- stored source links
- stored score reasons
- stored LLM digest enrichment artifacts if available

Not allowed:

- unconstrained live browsing

### Research

Allowed inputs:

- everything from `ask`
- bounded live search results
- official docs, official company posts, primary source materials, high-signal reporting

Requirements:

- bound the number of live sources
- prefer official sources first
- store the URLs used
- distinguish facts from inference

## Safety And Trust

### Daily Digest Boundary

The daily digest must not depend on live research.

If research systems fail, the digest still ships normally.

### User Intent Boundary

Live research should run only when the user clearly asks for it.

Good triggers:

- `research`
- `더 찾아봐`
- `최신 정보까지 조사해줘`

### Secret And Action Safety

News Q&A should not trigger host mutations, repo edits, or service changes.

If a question turns into an operational request, hand it off to the appropriate workspace skill and approval flow.

## Success Criteria

This feature is successful when:

1. users can ask natural follow-up questions without memorizing syntax
2. deterministic follow-up still works with no LLM
3. live research is clearly separated from deterministic digest behavior
4. answers include evidence references and links
5. Telegram UX remains concise and not menu-heavy
