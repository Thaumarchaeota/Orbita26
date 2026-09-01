# TickTick Cutover Checklist

## State machine

```text
desktop_direct → server_oauth_mirror → desktop_write_freeze → server_broker_active
```

## Pre-cutover

- [ ] Dida OAuth redirect URI confirmed for server HTTPS callback
- [ ] PKCE + state/CSRF transaction model tested
- [ ] Credential vault encrypt/decrypt/revoke tested
- [ ] Work command outbox schema deployed
- [ ] Reconciliation report baseline captured
- [ ] No desktop access token migration

## OAuth mirror phase

- [ ] Server OAuth flow completes with fresh credentials
- [ ] Project/task projection mirrored and hash-matched
- [ ] Desktop still direct until freeze

## Freeze phase

- [ ] Desktop stops direct Dida API calls
- [ ] Pending local commands drain to outbox
- [ ] No new desktop writes to TickTick

## Activate broker

- [ ] Transition to `server_broker_active`
- [ ] Server sole API caller
- [ ] Clients enqueue Orbita commands only
- [ ] Create-timeout commands require manual confirmation (no blind retry)

## Behavior verification

- [ ] Complete → undo within 3s window
- [ ] Due/start shift
- [ ] External edit conflict detected
- [ ] Offline command conflict detected
- [ ] Create timeout stops at manual confirmation

## Rollback

1. Pause server command worker
2. Inventory pending commands and TickTick mirror
3. Transition to `desktop_direct`
4. Never run dual-writer period
