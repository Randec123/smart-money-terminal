# Tradehound Terminal

A public, no-sign-in website that looks like the desktop and mobile Tradehound Terminal Pages.

- **Live, in the browser:** major-coin prices, Solana trending and new pools, boosted tokens, search, the selected token’s candlestick chart, and its public trades. These fetch straight from CoinGecko, GeckoTerminal, and DexScreener. No API keys.
- **Snapshot, not live:** smart-wallet / KOL counts, GMGN Smart Net Inflow, early accumulation, and insider / top-10 / sniper percentages. These are read from [`data/smart-money.json`](data/smart-money.json) and are always labeled with an **as of** timestamp so they are never mistaken for a live feed.

This repository is a static site: `index.html`, `app.js`, `styles.css`, and `data/smart-money.json`. There is no server-side code and there are no secrets.

## Live site and repo

Intended URLs, once GitHub Pages is enabled on this repo (account `Randec123`):

- Site: https://randec123.github.io/smart-money-terminal/
- Repo: https://github.com/Randec123/smart-money-terminal

If Pages is served from a project site, keep the asset paths relative (they already are).

## Install as an app

The site is a Progressive Web App. On a phone, open the live site in the browser, then:

- **Android (Chrome):** tap **Install app**, or the browser menu’s *Install app* / *Add to Home screen*.
- **iPhone / iPad (Safari):** tap **Share**, then **Add to Home Screen**. (Safari does not show the Install app button.)
- **Desktop (Chrome or Edge):** use the install icon in the address bar, or the **Install app** button in the sidebar.

Once installed it opens in its own window, without the browser chrome. Alerts still only fire while the app or a browser tab is open.


## What is live, and how often it refreshes

Every live panel shows a **LIVE** pill and a last-updated time in Eastern Time. Polling pauses when the tab is hidden, and every fetch backs off on HTTP 429 (honors `Retry-After` when present, otherwise exponential backoff up to 2 minutes).

| Panel | Source | Interval | Notes |
| --- | --- | --- | --- |
| Majors ticker (BTC, ETH, SOL, HYPE, BNB, XRP, DOGE, ZEC, SUI, LINK) | CoinGecko `simple/price` | 60s | CORS `Access-Control-Allow-Origin: *` verified |
| Token list — Trending | GeckoTerminal `networks/solana/trending_pools?include=base_token,quote_token,dex` | 60s | |
| Token list — New | GeckoTerminal `networks/solana/new_pools?include=…` | 60s | Fresh pools, not a smart-money signal |
| Token list — Boosted | DexScreener `token-boosts/latest/v1` + `tokens/v1/solana/<CAs>` | 60s | Boost amount is paid promotion |
| Search / paste a CA | DexScreener `latest/dex/search?q=` and `tokens/v1/{chain}/{address}` | on demand | Also used to resolve a snapshot ticker onto a live pool |
| Selected-token chart | GeckoTerminal `networks/{net}/pools/{addr}/ohlcv/minute or hour` | 45s | 1m / 5m / 15m / 1H / 4H; [lightweight-charts](https://unpkg.com/lightweight-charts@4.2.1/dist/lightweight-charts.standalone.production.js) from the CDN |
| Selected-token trades | GeckoTerminal `networks/{net}/pools/{addr}/trades?trade_volume_in_usd_greater_than=1` | 12s | Public tape, not labeled smart money |
| Flow tab, public movers, public buy-side filter | Same trending payload | 60s | Clearly labeled as public flow |
| Fib Pullback (desktop nav, mobile “Fib” tab) | Candidate list from GeckoTerminal Solana trending, PumpSwap `dexes/pumpswap/pools?sort=h24_volume_usd_desc`, all-chain `networks/trending_pools` (Runners + All chains), plus DexScreener `token-boosts/latest/v1` and `tokens/v1/{chain}/{CAs}`. Swings from GeckoTerminal `pools/{pool}/ohlcv` (hourly, or 15m for coins younger than 48 hours), converted to market cap. RugCheck / GoPlus risk badges reused from the holder-risk cache. | Candidate list every 2.5 min while the tab is open (6 min otherwise); one token’s candles every 8s in rotation while open (15s if Whale Flow is focused, 30s in the background), cached 4 min | Two presets: **Pump.fun ($40K+, 0.618/0.786)** and **Runners ($1M+, 0.618/0.786/0.886)**, plus a Solana / All chains switch (Pump.fun is Solana-only). Level = ATH − ratio × (ATH − low), where the ATH is the highest high and the swing low is the lowest low before that ATH. Status: Approaching (within 5%), At level, or Below the deepest level = invalidated. Filters: liquidity under ~$10K (Pump.fun) / $50K (Runners), 24h volume under $1K, RugCheck/GoPlus danger flags, and swings smaller than about 3×. Sorted by closest to a level. Alerts fire once per token+level in `localStorage` (`smt-fib-fired-v1`). Settings in `smt-fib-v1`. Pump.fun’s own API was tested and is **not** used (Cloudflare 403 / “Not allowed by CORS”); Pump.fun coins are detected from a mint ending in `pump` or a `pumpswap` / `pump-fun` / `pumpfun` pool and labeled as such. Levels are approximate public data, not financial advice. |
| Watchlist prices | DexScreener `tokens/v1/{chain}/{addresses}` | 60s | Watchlist is stored in `localStorage` (`smt-watchlist-v1`) |
| Whale Flow (live on-chain whale flow, public data, not smart-money labeled) | GeckoTerminal `networks/{net}/pools/{pool}/trades?trade_volume_in_usd_greater_than=<min>` across the top 10 trending pools (Solana, or all chains via `networks/trending_pools`) | one pool every 12s while the tab is open, every 30s otherwise (all-chain list every 2 min) | Min size $500/$1K/$2.5K/$5K/$10K or custom (default $1K), Buys/Sells/Both, last 60 min kept; wallets with 2+ large buys or 2+ tokens marked “repeat whale”; settings in `localStorage` (`smt-whale-v1`) |
| Custom price alerts | Same live prices | with those polls | Stored in `localStorage` (`smt-alerts-v1`); local only |
| Holder risk (Terminal, under the score) | Solana: RugCheck `api.rugcheck.xyz/v1/tokens/{mint}/report`. EVM (eth, bsc, base, arbitrum, polygon, avax, optimism): GoPlus `api.gopluslabs.io/api/v1/token_security/{chainId}?contract_addresses=` | on token select, cached 5 min | Red/amber/green flags. Solana: mint/freeze authority, LP locked % (≥90 green, ≥50 amber, else red), top-10 holders excluding AMM/lock/burn accounts (>50% red, >30% amber), largest holder (>20% red, >10% amber), insiders, insider network, transfer fee, `rugged`, RugCheck danger/warn risks. EVM: honeypot, buy/sell tax (>10% red, >0 amber), mintable, hidden owner, owner can change balance, pausable, proxy, source verified, top-10 unlocked holders, LP locked %. Unknown = **—**. Honeypot.is was tested and not used (404 “No pairs found” on test tokens). |
| Tracked Wallets (desktop nav, mobile “Wallets” tab) | **Primary:** `data/gmgn-top-wallets.json` (GMGN’s top 15 Solana smart wallets by 7D PnL, full addresses) polled through Solana RPC `solana-rpc.publicnode.com` (`getSignaturesForAddress` limit 5, `getTransaction` jsonParsed, `maxSupportedTransactionVersion: 1`). **Secondary:** `data/smart-wallets.json` (GMGN Smart Net Inflow wallets), matched only against the Whale Flow GeckoTerminal trade scan, never polled. Symbols from DexScreener `tokens/v1` | one top-15 wallet every 20s in rank order while on the tab (40s otherwise), ≥2.5s between RPC calls, 30–60s backoff on 403/429/network errors; lists reloaded every 10 min | Activity is tagged **top-15 profitable wallet** (primary) or **GMGN smart inflow** (secondary) in this tab, Whale Flow and alerts. The tab also lists “Top 15 by 7D PnL (GMGN, as of …)” with label/tags, 7D PnL, win rate, trades and a GMGN wallet link; those figures are GMGN’s at capture, not live. Secondary wallets are shown shortened by GMGN, so they match on the first 4 / last 4 characters (an inference) and learned addresses are kept in `localStorage` (`smt-resolved-wallets-v1`). Swap side/size come from balance changes (SOL, WSOL, USDC, USDT) and are estimates; **—** when unknown. Hits kept 6 h. The official `api.mainnet-beta.solana.com` RPC returned 403 and was not used. |
| Alerts (sound, browser notification, in-page toast) | Whale Flow buys ≥ your threshold, tracked-wallet buys, watchlist/custom price alerts, and Fib Pullback first touches of a 0.618 / 0.786 / 0.886 level | as those feeds update | Opt-in toggles at the top of **Custom Alerts**, mute pill in the status bar, stored in `localStorage` (`smt-notify-v1`). Throttle: one per kind per 20s and 8 per 5 min (extra are counted as “held back”). Only events after the page opened fire. Alerts work only while the site is open in a tab. |
| Smart-money tabs | `data/smart-money.json` | on load, then every 5 minutes (cache-busted) | **Snapshot.** Its own as-of time is always shown |

DexScreener `token-profiles/latest/v1` was verified (HTTP 200, CORS `*`) and is available for a later panel; the first version uses boosts, search, and token snapshots instead.

GeckoTerminal sends `Access-Control-Allow-Origin: *` when the request includes an `Origin` header (browser `fetch` does). CoinGecko and DexScreener send `*` unconditionally.

## Snapshot tabs (never treated as live)

These always show **SNAPSHOT as of 5:20 AM ET, Nov 13, 2026** (or whatever `asOfET` is in the JSON after a refresh):

- **Live Alerts** — GMGN Smart Net Inflow tape (ages are frozen as captured, 1s–28s then). A separate **LIVE** public-movers table sits underneath and is labeled as such.
- **Accumulation** — First Buy / Buy More from that tape (Sakura’s two First Buys, Maxcoin’s $345.80 Buy More, and the other First Buy / Buy More prints). Smart-wallet count is **—**. A separate live public buy-side table sits underneath.
- **KOL Signals** — KOL count is **—** for every token; GMGN did not show those counts.
- **Nansen Scan** — **not connected**. No Nansen numbers are shown or invented.
- **Smart $** list tab — the GMGN trending 10 with insider / top-10 / sniper percentages from the capture. NVIDIA’s 65% insider holding is flagged as a risk. Duplicate SolanaOS and Sakura tickers keep their distinct CAs.

Missing `smartWalletCount` and `kolCount` values are `null` in the file and render as **—**. Never write `0` to mean “not available.”

## `data/smart-money.json` schema

Path in the repo (and on the site): **`data/smart-money.json`**.

```json
{
  "asOfET": "5:20 AM ET, Nov 13, 2026",
  "asOfISO": "2026-11-13T05:20:00-05:00",
  "source": "GMGN Solana signed-in session capture",
  "nansenConnected": false,
  "notes": ["optional free-text notes, shown only in the file"],
  "trending": [
    {
      "address": "So1anaContractAddress…",
      "name": "LUMINA",
      "symbol": "LUMINA",
      "chain": "solana",
      "price": 0.000039,
      "mc": 48100,
      "chg1h": 1500,
      "vol1h": 213000,
      "holders": 440,
      "insiderPct": 0,
      "top10Pct": 8,
      "sniperPct": 0,
      "smartWalletCount": null,
      "kolCount": null
    }
  ],
  "smartFlows": [
    {
      "wallet": "FkEF…NNhf",
      "action": "First Buy",
      "token": "Sakura",
      "usd": 79.62,
      "age": "2s"
    }
  ]
}
```

Field rules:

- `asOfET` is required and is what the UI displays. Use an Eastern Time label (`… ET`). `asOfISO` is the same instant in ISO-8601 with offset.
- `nansenConnected` is a boolean. Leave it `false` and omit any Nansen figures unless a real Nansen session provided them.
- `trending[]` is the GMGN Solana 1h top list from the capture. `smartWalletCount` and `kolCount` must be `null` when GMGN did not show a count (the UI then shows —). Use a real number only when GMGN displayed one.
- `smartFlows[]` rows may add `"walletFull"` (the complete base58 address) whenever GMGN shows it; that lets the Tracked Wallets tab poll the wallet on-chain right away.
- `smartFlows[]`.`action` is one of `First Buy`, `Buy More`, `Sell All`, `Sell Partial`. `usd` is the signed net inflow (negative for sells). `age` is the literal age string GMGN showed at capture, not a live-updating age. `wallet` may be abbreviated the way GMGN showed it. `token` is the ticker as GMGN labeled it (the UI matches it to trending CAs by name; “Maxcoin” matches symbol `Max`; two Sakura CAs are both linked).
- Do not invent prices, percentages, wallet counts, or flow rows. If a field was not captured, use `null` or omit the row.

### How a scheduled refresh should update the file

A later 2-hour GMGN refresh should **overwrite** this file in place (same path, same schema) and commit it to `main`. The public site picks it up on the next `data/smart-money.json` fetch (every 5 minutes, cache-busted).

Suggested steps, once the GitHub repo exists and a machine can push:

1. Capture a new GMGN session (trending 10 + holder-risk fields + Smart Net Inflow tape + any real smart-wallet / KOL counts). Leave counts `null` if they still are not on the page. Leave `nansenConnected` false unless Nansen actually connected.
2. Write a complete new `data/smart-money.json` (do not merge leftover rows from an older capture). Set `asOfET` / `asOfISO` to the capture time in America/New_York.
3. Commit it with the helper script (needs `GH_TOKEN` in the environment; the token is sent as a one-off header and never saved):

```bash
./push-snapshot.sh   # merges wallets, commits both data files, pull --rebase, push
```

From a bot or MCP session that has **write** access, the equivalent is a contents-API update of `data/smart-money.json` on `main` (GitHub REST `PUT /repos/{owner}/{repo}/contents/data/smart-money.json`, or `gh api`). The Cursor GitHub connector available when this site was first built had **no** `create_or_update_file` / push / Pages tools, so a refresh job needs whatever write path is granted later.

4. GitHub Pages usually publishes in a minute or two. The live page does not need a full reload if it is open: it will refetch the JSON on its 5-minute timer.

## `data/gmgn-top-wallets.json` (primary tracked set)

Captured from GMGN’s Solana leaderboard (`https://gmgn.ai/rank?chain=sol&tab=smart_degen`, Smart Money filter, 7D, sorted by 7D PnL). Shape: `{ "asOfET": "<ISO time or … ET label>", "wallets": [ { "rank", "walletFull", "label", "tags": [], "pnl7dUsd", "pnl7dPct", "winRate7d", "trades7d", "pnl30dUsd", "lastActive", "sourceUrl" } ] }`. Values are the literal strings GMGN displayed (e.g. `"+$18.8K"`, `"39.1%"`); use `null` / `""` for anything not shown. At most 15 rows, each with a valid base58 `walletFull`. A refresh may overwrite the file with a new capture; `push-snapshot.sh` validates it and commits it whenever it changed.

## `data/smart-wallets.json` (secondary tracked wallets)

Built from every GMGN Smart Net Inflow row in `data/smart-money.json` and its git history. Top-level: `updatedET`, `updatedISO`, `source`, `cap` (50), `mergeRule`, `wallets[]`. Each wallet: `wallet` (GMGN short form `prefix…suffix`), `prefix`, `suffix`, `walletFull` (full address or `null`), `resolvedBy`, `label` (`GMGN smart inflow`), `firstSeenISO/ET`, `lastSeenISO/ET`, `lastSnapshotISO`, `snapshots`, `buys`, `sells`, `buyUsd`, `tokens[]`.

**Merge rule** (`tools/merge-wallets.py`, run by `push-snapshot.sh` before each commit):

1. Key every `smartFlows[]` row by `prefix…suffix` (both `…` and `...` accepted; from `walletFull` when present).
2. A wallet's counters change at most once per snapshot `asOfISO` (`lastSnapshotISO`), so re-running is a no-op.
3. A known `walletFull` is never dropped or overwritten; a new one is only taken from a real `walletFull` field, never guessed.
4. New wallets get `firstSeen` = that snapshot and label `GMGN smart inflow`.
5. Re-rank by snapshots seen, then buys, distinct tokens, buy USD; keep the top 50 (repeat wallets win).

`push-snapshot.sh` stages `data/smart-money.json`, `data/smart-wallets.json` and, when present and valid, `data/gmgn-top-wallets.json`.

## Local preview

```bash
cd smart-money-terminal
python3 -m http.server 8080
# open http://127.0.0.1:8080/
```

## Layout

- **Desktop:** dark terminal chrome, left sidebar (Live Alerts, Terminal, Accumulation, Flow, Watchlist, KOL Signals, Nansen Scan, Fib Pullback, Custom Alerts, Whale Flow, Tracked Wallets), majors ticker, then the workspace. Terminal is a three-column layout: token list, chart + setup cards, trades.
- **Phone (max-width 768px):** single column, bottom tab bar — Trending, Alerts, Accum., Charts, Watch, Fib, Whales, Wallets. Token cards expand to show insider / top-10 / sniper (on the snapshot list), copy CA, and links.

## Disclaimer

This is a research dashboard, not financial advice, and not a broker. Public API data can lag, and snapshot smart-money figures are only as current as the last JSON commit.
