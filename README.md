# OpenSec AI News Brief

OpenSec AI News Brief is a deterministic, single-user AI news briefing system built for Telegram delivery and OpenClaw orchestration.

The repository also ships personal-workspace assets so the same Telegram DM can handle repo and coding tasks through OpenClaw, not just news digests.

The repository is split into two main parts:

- [`/Users/ASTROHYO/Desktop/OpenSec/news-bot`](./news-bot): the actual news pipeline
- [`/Users/ASTROHYO/Desktop/OpenSec/skills/ai_news_brief/SKILL.md`](./skills/ai_news_brief/SKILL.md): the OpenClaw workspace skill that runs the pipeline

## What It Does

- fetches curated AI and developer-tooling sources
- normalizes and deduplicates items into SQLite
- ranks them with explicit scoring rules
- renders Korean Telegram-ready digests
- supports follow-up commands from stored digest context
- is designed to support optional LLM enrichment without losing deterministic fallbacks

## Repository Map

```text
OpenSec/
├── AGENTS.md
├── ARCHITECTURE.md
├── docs/
├── news-bot/
└── skills/
```

## Start Here

- Product and system overview: [`/Users/ASTROHYO/Desktop/OpenSec/ARCHITECTURE.md`](./ARCHITECTURE.md)
- Working conventions: [`/Users/ASTROHYO/Desktop/OpenSec/AGENTS.md`](./AGENTS.md)
- LLM upgrade plan: [`/Users/ASTROHYO/Desktop/OpenSec/docs/exec-plans/active/2026-04-02-llm-curation-upgrade.md`](./docs/exec-plans/active/2026-04-02-llm-curation-upgrade.md)
- Local app setup: [`/Users/ASTROHYO/Desktop/OpenSec/news-bot/README.md`](./news-bot/README.md)

## Personal OpenClaw Setup

If you want Telegram DM to become your personal AI control plane, use:

- config example: [`/Users/ASTROHYO/Desktop/OpenSec/openclaw.personal.example.jsonc`](./openclaw.personal.example.jsonc)
- workspace bootstrap script: [`/Users/ASTROHYO/Desktop/OpenSec/scripts/setup-personal-workspace.sh`](./scripts/setup-personal-workspace.sh)
- workspace templates: [`/Users/ASTROHYO/Desktop/OpenSec/workspace-template`](./workspace-template)
- personal control plane design note: [`/Users/ASTROHYO/Desktop/OpenSec/docs/design-docs/openclaw-personal-control-plane.md`](./docs/design-docs/openclaw-personal-control-plane.md)

Bundled skills for that setup:

- [`/Users/ASTROHYO/Desktop/OpenSec/skills/ai_news_brief/SKILL.md`](./skills/ai_news_brief/SKILL.md)
- [`/Users/ASTROHYO/Desktop/OpenSec/skills/code_ops/SKILL.md`](./skills/code_ops/SKILL.md)
- [`/Users/ASTROHYO/Desktop/OpenSec/skills/repo_ops/SKILL.md`](./skills/repo_ops/SKILL.md)
- [`/Users/ASTROHYO/Desktop/OpenSec/skills/system_ops/SKILL.md`](./skills/system_ops/SKILL.md)
