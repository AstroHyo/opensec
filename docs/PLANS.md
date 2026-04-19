# PLANS.md

Execution plans live under `docs/exec-plans/`.

- `active/`: work in progress or approved next work
- `completed/`: shipped plans kept for reference
- `tech-debt-tracker.md`: debt that should be scheduled, not forgotten

Current active plan:

- [`./exec-plans/active/2026-04-15-finance-brief-overhaul-and-tiered-routing.md`](./exec-plans/active/2026-04-15-finance-brief-overhaul-and-tiered-routing.md)

Plan hygiene rules:

- `active/` should contain only work with a real remaining execution step
- active plans should start with:
  - `Live status`
  - `Next step`
  - `Owner`
- once the shipped behavior is documented elsewhere, move the plan to `completed/` instead of letting `active/` turn into a history dump

Archive:

- shipped plans live under [`./exec-plans/completed/`](./exec-plans/completed/)

Rule of thumb:

- use `design-docs/` for durable principles
- use `exec-plans/` for implementation sequencing
- use `product-specs/` for user-facing behavior
