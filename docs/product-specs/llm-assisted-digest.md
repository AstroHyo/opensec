# LLM-Assisted Digest Spec

## Goal

Upgrade OpenSec from a fully deterministic digest to a deterministic-plus-LLM digest where the model improves explanation quality without taking over retrieval or state management.

## User Promise

The digest should feel:

- more natural in Korean
- more selective about what matters
- more explicit about why something matters
- still grounded in real fetched sources

## Must Preserve

- official source preference
- OpenAI priority
- repo relevance filtering
- direct source links
- follow-up command support
- non-LLM fallback path

## AM Experience

- 5 to 8 strong items
- short, clean summaries
- very low filler
- fast to scan on mobile

## PM Experience

- 8 to 15 items depending on quality
- better daily interpretation
- clearer separation between official updates, tooling methods, and repos

## Follow-up Experience

`expand N` and `why important N` should become more insightful, but still quote or point back to saved evidence rather than improvise.
