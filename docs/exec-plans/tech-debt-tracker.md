# Tech Debt Tracker

## Current Debt

1. LLM enrichment is not implemented yet, even though `OPENAI_API_KEY` is already present in config.
2. There is no golden evaluation corpus for digest quality regression checks.
3. The current Korean summary generation is template-based and repetitive on dense news days.
4. Theme synthesis is heuristic and not stored as a first-class artifact.
5. Prompt-injection-safe source bundling does not exist yet because there is no LLM stage.
6. OpenAI official HTML category fallback remains limited because headless access is Cloudflare-sensitive.

## Tracking Rule

Debt should move into an active execution plan once:

- it blocks product quality
- it creates reliability risk
- or it slows down future iteration
