# QUALITY_SCORE.md

Use this rubric when evaluating deterministic or LLM-assisted digest quality.

## 1. Signal Density

- 5: nearly every item feels worth attention
- 3: mixed quality, a few filler items
- 1: padded, obvious weak items

## 2. Factual Grounding

- 5: summaries stay tightly aligned to source evidence
- 3: some extrapolation without clear grounding
- 1: speculative or hallucinated claims

## 3. Prioritization Fit

- 5: OpenAI, tooling, agent methods, and meaningful repos are ranked well
- 3: partially aligned, but key priorities slip
- 1: popularity dominates user interest

## 4. Explanation Quality

- 5: "why important" is crisp and practical
- 3: correct but generic
- 1: vague, hypey, or repetitive

## 5. Format Quality

- 5: mobile-readable, compact, safe links, clean numbering
- 3: mostly readable with some clutter
- 1: noisy or hard to scan

## Ship Gate

Do not ship an LLM change by default unless it improves or preserves:

- factual grounding
- prioritization fit
- graceful fallback behavior

Prefer slower rollout over silent regression in trust.
