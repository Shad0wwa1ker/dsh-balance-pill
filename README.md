# dsh-balance-pill

A [DeepSeek Harness](https://github.com/deepseek-ai) Web-UI plugin that renders one compact pill under the composer:

```
¥12.34 · 谷时 · 本次 ¥0.0123
```

It shows the account balance, whether model pricing is currently at peak or off-peak rates, and what the current session has cost so far — priced per request, so a session that crosses 12:00 or 18:00 still totals correctly.

## Features

| Reading | Source | Refresh |
|---|---|---|
| Balance (recharge + granted) | `account.getBalance` → Platform `get_user_summary` | on mount, every 60 s, at the end of every turn, and on click |
| Peak / off-peak phase | local clock, Beijing time | every 30 s, no network |
| Session spend | `sessionCost` Host projection (fallback: `tokenUsage` estimate) | live, as each request settles |

- Both wallet kinds are summed per currency (CNY preferred), because Platform bills them together and spends granted credit first. Hovering the pill breaks the total into recharge and granted amounts.
- Peak windows follow the official rule: Beijing time, Monday–Friday, 09:00–12:00 and 14:00–18:00. Lunch breaks, weekends, and statutory holidays are off-peak all day. The 2026 State Council holiday list is built in.
- Each request is priced as `hit × hit_rate + (miss + cache_write) × miss_rate + output × output_rate`, per million tokens, at the rate in effect when that request's step started:

| deepseek-flash | off-peak | peak |
|---|---|---|
| input, cache hit | ¥0.02 | ¥0.04 |
| input, cache miss | ¥1 | ¥2 |
| output | ¥4 | ¥8 |

## Exact pricing

The Host half folds the durable session log into one client-visible projection, `sessionCost`:

- `step/start` stamps the millisecond a step began, and that stamp is the billing time for the step's request.
- `assistant/message` carries the provider's final usage; `assistant/attempt` carries the last usage chunk of a cancelled or rebuilt stream. A later sample for the same turn/step replaces the earlier one, and `llm/retry-started` closes the replacement slot so a retried attempt is billed again.
- `request/header` supplies the model, selecting the `deepseek-flash` or `deepseek-v4-pro` price list; an unknown model falls back to flash.
- Because the fold runs on the Host, paging and compaction never drop priced history.

If the projection is unavailable (older Host, or a profile without `sessionProjections`), the browser falls back to the previous estimate: whole-session `tokenUsage` at the current phase.

## Install

Requires DeepSeek Harness 0.2.x with a signed-in DeepSeek account (the balance comes from the account session, not an API key).

**Option A — Plugin Manager** (Harness ≥ 0.2.1): open **Plugins**, choose *install from a directory*, and point it at this package's directory. The bundle patch registers the row automatically.

**Option B — manual link** into a profile:

```bash
cd "$DSH_PROFILE_DIR"          # e.g. ~/.dsh/profiles/desktop
pnpm add link:/absolute/path/to/dsh-balance-pill
```

Then append to that profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: balance-pill
      name: '@local/dsh-balance-pill'
```

Reload the page (or restart Harness) once so the browser loads the new client module. The Host projection is Host code: it takes effect on the next Harness start, while the page only needs a reload.

## Configuration

None. Prices and the holiday list are constants near the top of both `index.js` (pricing) and `client.js` (fallback estimate and phase display); edit them there if DeepSeek changes either. The plugin stores no credentials and makes no requests beyond the account balance call the UI already owns.

## Accuracy notes

- **The session figure prices each request at its own phase.** A request whose step starts before 12:00 stays at peak even if the answer lands after it. The billing timestamp is the step start, which is the closest durable event to when the request was sent.
- **Model tier comes from the request header.** `deepseek-v4-pro` uses the Pro list; anything else is treated as flash. Custom models that bill differently will be mispriced.
- **Balance is a snapshot.** It reflects Platform at the last refresh, so it can lag the messages you just sent by up to a minute.
- **Search/Fetch calls are excluded.** They bill per request rather than per token and do not appear in the log's usage samples.
- **Non-DeepSeek routes** (for example Anthropic-compatible providers) are priced with DeepSeek rates; the pill is meant for a DeepSeek account.

## How it works

- `index.js` — Host half. Registers the `sessionCost` projection with `ctx.sessionProjections`; the fold, price tables, and holiday list live here. Registration is optional, so profiles without the projection registry still load the plugin.
- `client.js` — browser module registered through `window.__ModuleLoader__`. It injects `slots`, `locale`, `remote`, `remote.account`, registers one entry in the session-scoped `conversation.composer.dock` slot, and reads `useSession` / `useProjection` standard props for turn state and both projections.
- `cordis.patch.yml` — inserts the `balance-pill` row.
- `locale/*.json` — plugin-manager display metadata (zh / en).

## Privacy

The repository contains no tokens, cookies, account identifiers, balances, or local paths. The pill reads the balance through the Harness account session that is already open; nothing is persisted by the plugin.

## License

MIT
