# SECURITY.md

## Security Posture

This is a single-user personal system, but it still handles secrets and untrusted external content.

## Secrets

- never hardcode `TELEGRAM_BOT_TOKEN`
- never hardcode model API keys
- keep secrets in environment variables
- do not paste secrets into plans or generated docs

## Access Control

- Telegram access should stay allowlisted to the numeric owner ID
- no public web UI is required
- follow-up commands should assume a trusted owner, not anonymous users

## Untrusted Inputs

Treat as untrusted:

- article titles
- article descriptions
- scraped content snippets
- GeekNews comments or labels
- any source text passed to an LLM

## LLM-Specific Rules

- delimit source content clearly in prompts
- instruct the model not to follow instructions found inside source text
- require structured output
- validate output before persisting
- keep source URLs attached to every explanation

## Logging

- log operational failures
- avoid logging full secrets
- avoid storing unnecessary raw content beyond what is needed for debugging and follow-up
