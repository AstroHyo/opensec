# OpenClaw Personal Control Plane

## Why This Matters

If your long-term goal is:

- receiving news digests
- asking for ad hoc tasks over Telegram DM
- running repo work and infra tasks remotely
- keeping memory and context across sessions

then OpenClaw should not be set up as a "news bot host."

It should be set up as your personal AI control plane, with the news system as just one skill inside it.

## Recommended Mental Model

Use OpenClaw for:

- always-on gateway
- Telegram DM access
- durable memory and session history
- tool orchestration
- cron automation
- approval flow for risky host actions

Use project repos like OpenSec for:

- deterministic application logic
- custom skills
- scripts
- repo-specific documentation

This matches the official OpenClaw positioning: it is a personal assistant and coordination layer, not a pure IDE replacement. The Gateway is the always-on control plane, while coding tools and repos remain separate execution targets.

## Recommended Topology

### One Gateway, One Main Personal Agent

Start with:

- one OpenClaw gateway on the VPS
- one main personal agent bound to your Telegram DM
- one stable personal workspace on the VPS

Why:

- simplest operations
- one memory system
- one Telegram relationship
- fewer routing surprises

### News As A Skill, Not A Separate Product Brain

Keep OpenSec AI News Brief as:

- a project repo under your workspace
- a dedicated skill for digest generation and follow-up
- a cron-driven workflow

Do not make it the only workspace.

Instead, the personal agent should be able to:

- run the news bot
- open and edit repos
- execute scripts
- remember preferences
- handle one-off tasks from DM

## Recommended VPS Layout

```text
/srv/openclaw/workspace-personal
├── AGENTS.md
├── SOUL.md
├── TOOLS.md
├── USER.md
├── MEMORY.md
├── memory/
├── skills/
│   ├── ai_news_brief/
│   ├── repo_ops/
│   ├── system_ops/
│   └── inbox_ops/
├── projects/
│   ├── opensec-ai-news-brief/
│   ├── repo-a/
│   └── repo-b/
└── scratch/
```

## Why This Layout Is Better Than Using The OpenSec Repo Root

OpenClaw uses a single workspace directory as the agent’s default working directory and memory context.

That means your workspace should be:

- stable
- personal
- long-lived
- broader than one app repo

If you point OpenClaw directly at the OpenSec repo root:

- memory files and personal instructions get mixed with one application repo
- future DM tasks unrelated to OpenSec feel awkward
- adding more repos becomes messy

So the right design is:

- OpenClaw workspace = personal operations home
- OpenSec repo = one project under `projects/`

## Recommended Agent Strategy

### Phase 1: Single-Agent Mode

Start in single-agent mode.

This gives you:

- one DM entrypoint
- one memory layer
- one place for skills
- lower setup complexity

Recommended role of the main agent:

- personal operator
- repo runner
- news assistant
- scheduler coordinator

Bootstrap assets in this repo:

- `openclaw.personal.example.jsonc`
- `scripts/setup-personal-workspace.sh`
- `workspace-template/`
- `skills/ai_news_brief/`
- `skills/repo_ops/`
- `skills/system_ops/`

### Phase 2: Add A Second Agent Only If Needed

Later, add a separate `news` or `automation` agent only if:

- background cron noise starts polluting your personal memory
- you want a different bot/account/personality
- you want harder isolation of tools or workspace

OpenClaw supports multiple isolated agents, each with separate workspace, state, and sessions.

But you do not need that on day one.

## Telegram Strategy

### One Telegram DM As Primary Front Door

Bind your main Telegram bot/account to the main personal agent.

Use:

- `dmPolicy: "allowlist"`
- numeric `allowFrom`
- no public access

This keeps the assistant private and durable.

### Keep Telegram Menus Small

Telegram command menus can overflow.

So for a personal assistant setup:

- keep native commands on if you like them
- keep native skill registration conservative
- rely mostly on typed DM instructions rather than a giant slash-command catalog

Recommended direction:

- keep `commands.text: true`
- consider `channels.telegram.commands.nativeSkills: false` if menus get noisy
- add only a few custom commands if they are truly frequent

Examples of good typed interactions:

- `brief now`
- `openai only`
- `pull latest from repo-a and summarize changes`
- `check the server disk usage`
- `run tests in opensec-ai-news-brief`
- `summarize today's open loops`

## Approval And Safety Model

If the agent will run real host commands from Telegram DM, approval flow matters.

Recommended:

- enable Telegram exec approvals
- approvals should go only to your own Telegram DM
- keep dangerous command execution gated

Why:

- DM remains convenient
- risky shell actions still need an explicit approval click
- you can safely let the assistant coordinate repo or infra work without making it fully fire-and-forget

## Recommended Config Direction

This is a good starting shape for `~/.openclaw/openclaw.json`:

```jsonc
{
  agents: {
    defaults: {
      workspace: "/srv/openclaw/workspace-personal",
      model: {
        primary: "anthropic/claude-sonnet-4-6",
        fallbacks: ["openai/gpt-5.2"]
      }
    }
  },
  channels: {
    telegram: {
      enabled: true,
      botToken: "123456789:replace-me",
      dmPolicy: "allowlist",
      allowFrom: ["123456789"],
      linkPreview: false,
      streaming: "partial",
      commands: {
        native: "auto",
        nativeSkills: false
      },
      execApprovals: {
        enabled: true,
        approvers: ["123456789"],
        target: "dm"
      }
    }
  },
  cron: {
    enabled: true
  }
}
```

Repository helper:

- copy from `openclaw.personal.example.jsonc`

Notes:

- the model refs above are examples from the official config docs, not a mandate
- if you prefer another supported provider, keep the same structure
- keep the news app’s `OPENAI_API_KEY` separate from OpenClaw’s own provider configuration

## Memory Strategy

### Start With Builtin Memory

Builtin memory is enough for the first version.

It uses:

- `MEMORY.md` for durable facts
- `memory/YYYY-MM-DD.md` for daily context

This is ideal for:

- your preferences
- repo conventions
- recurring workflows
- server notes
- decisions and open loops

### Add Honcho Later If You Want Richer Cross-Session Modeling

Honcho becomes interesting if you want:

- automatic user modeling
- semantic recall across long periods
- multi-agent memory awareness

But it is not required on day one.

Recommendation:

- phase 1: builtin memory
- phase 2: Honcho only if memory quality becomes a bottleneck

## Skill Strategy

Treat skills as the stable interface between DM intent and concrete system behavior.

Recommended initial skill set:

- `ai_news_brief`
  - digest generation
  - follow-up on saved digest context
- `repo_ops`
  - open repo
  - run tests
  - inspect diffs
  - pull and summarize
- `system_ops`
  - disk / memory / service status
  - log inspection
  - health checks
- `inbox_ops`
  - summarize tasks, notes, or files in the workspace

This is better than enabling generic freeform shell access too early.

## Where "Codex-Like" Work Fits

If you want coding-heavy DM workflows, the best setup is:

- OpenClaw = always-on coordinator and remote chat front door
- repo-specific skills = controlled entrypoints into code work
- exec/shell = execution path on the VPS

In other words:

- ask from Telegram DM
- OpenClaw routes intent
- skill runs deterministic repo command or coding workflow
- approval flow protects risky actions

This gives you "Codex from DM" behavior in practice, even though OpenClaw itself is not trying to replace a dedicated local IDE loop.

## Nodes: When To Add Them

If later you want the assistant to use tools on your laptop or phone:

- add a node
- do not add a second gateway unless you need hard isolation

This is the official OpenClaw direction for second devices.

Good reasons to add a node:

- local browser actions on your Mac
- local screen/camera access
- local exec on the node platform when supported
- device-specific capabilities

Good reasons not to add a second gateway:

- duplicated config
- duplicated memory
- more routing complexity

## Best Long-Term Setup For You

If the goal is:

- personal Telegram DM as command center
- OpenSec news digests
- future repo work and infra tasks
- coding-capable assistant behavior

then the best long-term setup is:

1. one Gateway on a VPS
2. one main personal agent in a dedicated personal workspace
3. OpenSec repo cloned under `projects/`
4. OpenSec exposed as a skill and cron job
5. builtin memory first
6. Telegram allowlist + exec approvals enabled
7. add nodes later for laptop-local capabilities
8. add second agent only when you truly need isolation

## Decision Summary

Do this:

- OpenClaw as personal control plane
- OpenSec as one project/skill inside that plane
- Telegram DM as the single private front door
- one gateway, one main agent, one workspace

Concrete repo helpers:

- scaffold the workspace with `scripts/setup-personal-workspace.sh`
- use `skills/repo_ops` and `skills/system_ops` for non-news DM tasks

Do not do this:

- make the OpenSec repo root your only workspace
- run multiple gateways too early
- expose the bot publicly
- depend on raw freeform shell without approval gating
