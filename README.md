# Smart Money Terminal

A public, no-sign-in website that looks like the desktop and mobile Smart Money Terminal Pages.

- **Live, in the browser:** major-coin prices, Solana trending and new pools, boosted tokens, search, the selected token’s candlestick chart, and its public trades. These fetch straight from CoinGecko, GeckoTerminal, and DexScreener. No API keys.
- **Snapshot, not live:** smart-wallet / KOL counts, GMGN Smart Net Inflow, early accumulation, and insider / top-10 / sniper percentages. These are read from [`data/smart-money.json`](data/smart-money.json) and are always labeled with an **as of** timestamp so they are never mistaken for a live feed.

This repository is a static site: `index.html`, `app.js`, `styles.css`, and `data/smart-money.json`. There is no server-side code and there are no secrets.

## Live site and repo

Intended URLs, once GitHub Pages is enabled on this repo (account `Randec123`):

- Site: https://randec123.github.io/smart-money-terminal/
- Repo: https://github.com/Randec123/smart-money-terminal

If Pages is served from a project site, keep the asset paths relative (they already are).

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
| Fib Levels | Derived from the live candle set | with candles | Geometric retracement only |
| Watchlist prices | DexScreener `tokens/v1/{chain}/{addresses}` | 60s | Watchlist is stored in `localStorage` (`smt-watchlist-v1`) |
| Whale Flow (live on-chain whale flow, public data, not smart-money labeled) | GeckoTerminal `networks/{net}/pools/{pool}/trades?trade_volume_in_usd_greater_than=<min>` across the top 10 trending pools (Solana, or all chains via `networks/trending_pools`) | one pool every 12s while the tab is open, every 30s otherwise (all-chain list every 2 min) | Min size $500/$1K/$2.5K/$5K/$10K or custom (default $1K), Buys/Sells/Both, last 60 min kept; wallets with 2+ large buys or 2+ tokens marked “repeat whale”; settings in `localStorage` (`smt-whale-v1`) |
| Custom price alerts | Same live prices | with those polls | Stored in `localStorage` (`smt-alerts-v1`); local only |
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
- `smartFlows[]`.`action` is one of `First Buy`, `Buy More`, `Sell All`, `Sell Partial`. `usd` is the signed net inflow (negative for sells). `age` is the literal age string GMGN showed at capture, not a live-updating age. `wallet` may be abbreviated the way GMGN showed it. `token` is the ticker as GMGN labeled it (the UI matches it to trending CAs by name; “Maxcoin” matches symbol `Max`; two Sakura CAs are both linked).
- Do not invent prices, percentages, wallet counts, or flow rows. If a field was not captured, use `null` or omit the row.

### How a scheduled refresh should update the file

A later 2-hour GMGN refresh should **overwrite** this file in place (same path, same schema) and commit it to `main`. The public site picks it up on the next `data/smart-money.json` fetch (every 5 minutes, cache-busted).

Suggested steps, once the GitHub repo exists and a machine can push:

1. Capture a new GMGN session (trending 10 + holder-risk fields + Smart Net Inflow tape + any real smart-wallet / KOL counts). Leave counts `null` if they still are not on the page. Leave `nansenConnected` false unless Nansen actually connected.
2. Write a complete new `data/smart-money.json` (do not merge leftover rows from an older capture). Set `asOfET` / `asOfISO` to the capture time in America/New_York.
3. Commit only that file to `main`:

```bash
git add data/smart-money.json
git commit -m "Refresh GMGN smart-money snapshot (as of … ET)"
git push origin main
```

From a bot or MCP session that has **write** access, the equivalent is a contents-API update of `data/smart-money.json` on `main` (GitHub REST `PUT /repos/{owner}/{repo}/contents/data/smart-money.json`, or `gh api`). The Cursor GitHub connector available when this site was first built had **no** `create_or_update_file` / push / Pages tools, so a refresh job needs whatever write path is granted later.

4. GitHub Pages usually publishes in a minute or two. The live page does not need a full reload if it is open: it will refetch the JSON on its 5-minute timer.

## Local preview

```bash
cd smart-money-terminal
python3 -m http.server 8080
# open http://127.0.0.1:8080/
```

## Layout

- **Desktop:** dark terminal chrome, left sidebar (Live Alerts, Terminal, Accumulation, Flow, Watchlist, KOL Signals, Nansen Scan, Fib Levels, Custom Alerts), majors ticker, then the workspace. Terminal is a three-column layout: token list, chart + setup cards, trades.
- **Phone (max-width 768px):** single column, bottom tab bar — Trending, Alerts, Accum., Charts, Watch — matching the mobile Page. Token cards expand to show insider / top-10 / sniper (on the snapshot list), copy CA, and links.

## Disclaimer

This is a research dashboard, not financial advice, and not a broker. Public API data can lag, and snapshot smart-money figures are only as current as the last JSON commit.
