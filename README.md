# dsh-balance-pill

A [DeepSeek Harness](https://github.com/deepseek-ai) Web-UI plugin that renders one compact pill under the composer:

```
¥12.34 · 谷时 · 本次 ¥0.0123
```

It shows the account balance, whether model pricing is currently at peak or off-peak rates, and an estimate of what the current session has cost so far.

## Features

| Reading | Source | Refresh |
|---|---|---|
| Balance (recharge + granted) | `account.getBalance` → Platform `get_user_summary` | on mount, every 60 s, at the end of every turn, and on click |
| Peak / off-peak phase | local clock, Beijing time | every 30 s, no network |
| Session spend | `tokenUsage` projection × `deepseek-flash` list prices | live, as provider usage arrives |

- Both wallet kinds are summed per currency (CNY preferred), because Platform bills them together and spends granted credit first. Hovering the pill breaks the total into recharge and granted amounts.
- Peak windows follow the official rule: Beijing time, Monday–Friday, 09:00–12:00 and 14:00–18:00. Lunch breaks, weekends, and statutory holidays are off-peak all day. The 2026 State Council holiday list is built in.
- Session spend is priced as `hit × hit_rate + (miss + cache_write) × miss_rate + output × output_rate`, per million tokens:

| deepseek-flash | off-peak | peak |
|---|---|---|
| input, cache hit | ¥0.02 | ¥0.04 |
| input, cache miss | ¥1 | ¥2 |
| output | ¥4 | ¥8 |

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

Reload the page (or restart Harness) once so the browser loads the new client module.

## Configuration

None. Prices and the holiday list are constants at the top of `client.js`; edit them there if DeepSeek changes either. The plugin stores no credentials and makes no requests beyond the account balance call the UI already owns.

## Accuracy notes

- **The session figure is an estimate.** It multiplies whole-session provider-reported tokens by list prices. Requests that straddle a peak boundary are priced uniformly at the phase in effect when the pill renders, so a session spanning 12:00 or 18:00 can differ from the invoice.
- **Model tier is fixed to `deepseek-flash`.** Sessions switched to a different model are under-reporting; the price table is a small map in `client.js`.
- **Balance is a snapshot.** It reflects Platform at the last refresh, so it can lag the messages you just sent by up to a minute.
- Search/Fetch API calls are billed per request and are not included in the token-based estimate.

## How it works

- `index.js` — empty Host half; its only job is to give the bundle a row in the plugin tree.
- `client.js` — browser module registered through `window.__ModuleLoader__`. It injects `slots`, `locale`, `remote`, `remote.account`, registers one entry in the session-scoped `conversation.composer.dock` slot, and reads `useSession` / `useProjection` standard props for turn state and token usage.
- `cordis.patch.yml` — inserts the `balance-pill` row.
- `locale/*.json` — plugin-manager display metadata (zh / en).

## Privacy

The repository contains no tokens, cookies, account identifiers, balances, or local paths. The pill reads the balance through the Harness account session that is already open; nothing is persisted by the plugin.

## License

MIT
