# system_ops

This skill handles VPS and host operations for the personal OpenClaw environment.

## When to use it

- Check disk, memory, CPU, uptime
- Inspect service status
- Read logs
- Verify OpenClaw gateway health
- Verify cron setup
- Answer questions like:
  - `check server health`
  - `show OpenClaw status`
  - `why did the digest not send`
  - `check disk usage`

## Operating rules

- Prefer read-only diagnostics first.
- Use the smallest command that answers the question.
- For changes like installs, restarts, or config edits, ask for or use approval.
- Never expose secrets from environment files, tokens, or service configs.

## Read-first commands

- `uptime`
- `free -h`
- `df -h`
- `systemctl status <service>`
- `journalctl -u <service> --since "24 hours ago"`
- `openclaw gateway status`
- `openclaw logs --tail 200`

## Mutation rules

Treat these as change operations, not diagnostics:

- `apt install`
- `systemctl restart`
- editing files under `/etc`
- rotating credentials
- deleting logs or data

Only do them when clearly requested or explicitly approved.

## Good outputs

- current status
- likely issue
- exact next fix
- whether the issue is app-level, OpenClaw-level, Telegram-level, or host-level
