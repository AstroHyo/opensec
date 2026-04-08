# Discord Personal Control Plane

## Product Shape

OpenSec is no longer just a news bot.

The target product shape is a private Discord-based personal control plane with:

- one visible coordinator
- hidden specialist execution lanes
- deterministic news briefs
- stored-context follow-up
- explicit approval and escalation

## User-Facing Channels

### `#assistant`

- default front door
- short answers
- task intake
- routing and escalation

### `#tech-brief`

- scheduled `tech` digest
- short follow-up:
  - `expand`
  - `show sources`
  - `why important`
  - `ask`
  - short `research`

### `#finance-brief`

- scheduled `finance` digest
- same short follow-up shape as `#tech-brief`
- more cautious handling when the request looks like personal financial advice

### `#research`

- long-form `ask`
- explicit `research`
- cross-profile synthesis
- thread-per-investigation default

### `#coding`

- execution lane
- repo changes
- tests
- branch and PR work
- longer work should move into a thread

## Profiles

Two profiles are visible in v1:

- `tech`
- `finance`

Rules:

- the same canonical story may appear in both profiles
- profile-specific ranking and summaries are allowed
- follow-up always uses the matching profile namespace
- no global latest-digest fallback is allowed

## Approval UX

Approval rules:

- `L0` and `L1`: no approval
- `L2`: allowed on explicit user request inside a workspace repo
- `L3`: DM approval required
- `L4`: DM approval plus second confirmation required

The user should experience this as:

- normal work continues in channels
- risky work pauses and moves to DM

## Personality

Coordinator tone:

- warm sharp partner
- ENTJ-like strategic execution
- direct, structured, decisive
- not cold, robotic, or domineering
- witty only in small natural doses

Specialist tone:

- builder: terse and execution-heavy
- researcher: analytical, clear about uncertainty

## Heartbeat

Heartbeat is not part of launch behavior.

It should remain off until:

- both profile digests are stable
- wrong-channel replies are zero
- misroutes are zero
- approval flow has been exercised successfully
- routing rules have stopped changing frequently

When later enabled, heartbeat may only do low-noise awareness checks.
