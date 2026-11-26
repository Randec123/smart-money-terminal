#!/usr/bin/env python3
"""Build data/hl-smart.json for the WickHound Terminal HL Stock Perps page.

Reuses /workspace/early-gap/smart_entries.py to pull Hyperliquid xyz
stock-perp wallet snapshots via the official public API. Does not write
Early Gap Scout state.json and does not run alert / dedupe logic.

If a live book fetch fails, falls back to the last scout snapshot in
state.json (marks and stale flags are refreshed when possible).

  python3 tools/build-hl-smart.py
  python3 tools/build-hl-smart.py --out data/hl-smart.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
EARLY_GAP = Path("/workspace/early-gap")
DEFAULT_OUT = ROOT / "data" / "hl-smart.json"
DEFAULT_CONFIG = EARLY_GAP / "config.json"
TOP_WALLETS = 10
DAILY_DAYS = 365
HOURLY_DAYS = 21
DISCLAIMER = "Public-wallet snapshot, not a trade signal."
SOURCE = (
    "Hyperliquid public API (xyz stock perps). Universe: wallets with "
    "all-time perp PnL of $200k+, account value of $2k+, and all-time "
    "volume under $10B, capped at 400, preferring wallets already seen "
    "on watchlist names."
)

sys.path.insert(0, str(EARLY_GAP))
import smart_entries as se  # noqa: E402


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr)


def pct_from_entry(entry: float | None, mark: float | None) -> float | None:
    if not entry or not mark:
        return None
    return (mark / entry - 1.0) * 100.0


def upnl_usd(side: str, entry: float, notional: float, mark: float | None) -> float | None:
    if not entry or mark is None or notional is None:
        return None
    if side == "LONG":
        return (mark - entry) / entry * notional
    if side == "SHORT":
        return (entry - mark) / entry * notional
    return None


def top_wallets(wallets: dict, mark: float | None, limit: int = TOP_WALLETS) -> list[dict]:
    rows: list[dict] = []
    for addr, meta in (wallets or {}).items():
        try:
            notional = float(meta.get("notional") or 0)
        except (TypeError, ValueError):
            notional = 0.0
        try:
            entry = float(meta.get("entry") or 0)
        except (TypeError, ValueError):
            entry = 0.0
        side = meta.get("side") or ""
        rows.append(
            {
                "address": addr,
                "side": side,
                "notional": round(notional, 2),
                "entry": round(entry, 4) if entry else None,
                "upnl": (
                    None
                    if (pnl := upnl_usd(side, entry, notional, mark)) is None
                    else round(pnl, 2)
                ),
            }
        )
    rows.sort(key=lambda r: abs(r.get("notional") or 0), reverse=True)
    return rows[:limit]


def snap_from_stored(ticker: str, rec: dict, stale_pct: float, mark: float | None) -> dict:
    snap = dict(rec)
    snap["ticker"] = ticker
    if mark is not None:
        snap["mark"] = mark
    used_mark = snap.get("mark")
    snap["stale_long"] = se.is_stale(snap.get("long_entry"), used_mark, stale_pct)
    snap["stale_short"] = se.is_stale(snap.get("short_entry"), used_mark, stale_pct)
    return snap


def ticker_payload(item: dict, snap: dict, stale_pct: float, candles: dict) -> dict:
    mark = snap.get("mark")
    long_e = snap.get("long_entry")
    short_e = snap.get("short_entry")
    return {
        "ticker": item["ticker"],
        "coin": item.get("hyperliquid"),
        "direction": snap.get("direction") or "FLAT",
        "netUsd": round(float(snap.get("net_usd") or 0), 2),
        "longUsd": round(float(snap.get("long_usd") or 0), 2),
        "longN": int(snap.get("long_n") or 0),
        "longEntry": None if long_e is None else round(float(long_e), 4),
        "longStale": bool(snap.get("stale_long")),
        "longPctFromEntry": (
            None
            if (p := pct_from_entry(long_e, mark)) is None
            else round(p, 2)
        ),
        "shortUsd": round(float(snap.get("short_usd") or 0), 2),
        "shortN": int(snap.get("short_n") or 0),
        "shortEntry": None if short_e is None else round(float(short_e), 4),
        "shortStale": bool(snap.get("stale_short")),
        "shortPctFromEntry": (
            None
            if (p := pct_from_entry(short_e, mark)) is None
            else round(p, 2)
        ),
        "mark": None if mark is None else round(float(mark), 4),
        "wallets": top_wallets(snap.get("wallets") or {}, mark),
        "candles": candles,
    }


def candle_row(bar: dict, interval: str) -> list | None:
    try:
        t_ms = int(bar.get("t"))
        o = float(bar["o"])
        h = float(bar["h"])
        l = float(bar["l"])
        c = float(bar["c"])
        v = float(bar.get("v") or 0)
    except (TypeError, ValueError, KeyError):
        return None
    if interval == "1d":
        day = datetime.fromtimestamp(t_ms / 1000, timezone.utc).strftime("%Y-%m-%d")
        t: int | str = day
    else:
        t = int(t_ms // 1000)
    return [t, o, h, l, c, v]


def fetch_candles(coin: str, interval: str, start_ms: int, end_ms: int) -> list:
    data = se.http_json(
        se.INFO_URL,
        {
            "type": "candleSnapshot",
            "req": {
                "coin": coin,
                "interval": interval,
                "startTime": start_ms,
                "endTime": end_ms,
            },
        },
        timeout=30,
        tries=3,
    )
    if not isinstance(data, list):
        return []
    rows = []
    for bar in data:
        if not isinstance(bar, dict):
            continue
        row = candle_row(bar, interval)
        if row:
            rows.append(row)
    return rows


def load_marks() -> dict[str, float]:
    return se.parse_xyz_marks(se.http_json(se.INFO_URL, {"type": "metaAndAssetCtxs", "dex": "xyz"}))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument(
        "--from-state",
        action="store_true",
        help="Skip the live wallet book and use state.json only (still refreshes marks and candles).",
    )
    args = parser.parse_args(argv)

    t0 = time.time()
    cfg = json.loads(Path(args.config).read_text())
    watchlist = [w for w in (cfg.get("watchlist") or []) if w.get("hyperliquid")]
    if not watchlist:
        eprint("hl-smart build: no Hyperliquid watchlist names")
        return 1
    settings = se.hl_settings(cfg)
    stale_pct = settings["stale_pct"]
    now = datetime.now(se.ET)
    state_path = Path(cfg.get("state_path") or (EARLY_GAP / "state.json"))
    state = se.load_json(state_path) or {}
    prev = state.get(se.STATE_KEY) or {}
    seen = list(prev.get("seen_wallets") or [])
    stored = dict(prev.get("tickers") or {})

    book = None
    source = "live"
    if not args.from_state:
        try:
            book = se.fetch_book(cfg, cfg.get("watchlist") or [], seen, now)
        except Exception as err:
            eprint(f"hl-smart build: live fetch failed: {err}")
            book = None
    if book and book.get("snaps"):
        snaps = book["snaps"]
        universe = book.get("meta") or {}
    else:
        source = "state-fallback" if not args.from_state else "state"
        eprint(f"hl-smart build: using {source} snapshots")
        marks: dict[str, float] = {}
        try:
            marks = load_marks()
        except Exception as err:
            eprint(f"hl-smart build: mark refresh failed: {err}")
        snaps = {}
        for item in watchlist:
            ticker = item["ticker"]
            rec = stored.get(ticker)
            if not rec:
                continue
            snaps[ticker] = snap_from_stored(
                ticker, rec, stale_pct, marks.get(item["hyperliquid"])
            )
        universe = dict(prev.get("universe") or {})
        universe["cache"] = universe.get("cache") or "state"
        if not snaps:
            eprint("hl-smart build: no snapshots available")
            return 1

    end_ms = int(now.timestamp() * 1000)
    daily_start = int((now - timedelta(days=DAILY_DAYS)).timestamp() * 1000)
    hourly_start = int((now - timedelta(days=HOURLY_DAYS)).timestamp() * 1000)
    tickers_out: list[dict] = []
    for item in watchlist:
        ticker = item["ticker"]
        snap = snaps.get(ticker)
        if not snap:
            continue
        coin = item["hyperliquid"]
        candles: dict[str, list] = {"1d": [], "1h": []}
        try:
            candles["1d"] = fetch_candles(coin, "1d", daily_start, end_ms)
            time.sleep(0.05)
            candles["1h"] = fetch_candles(coin, "1h", hourly_start, end_ms)
        except Exception as err:
            eprint(f"hl-smart build: candles failed for {ticker}: {err}")
        tickers_out.append(ticker_payload(item, snap, stale_pct, candles))

    if not tickers_out:
        eprint("hl-smart build: no ticker payloads")
        return 1

    as_of_et = se.fmt_et_safe(now)
    payload = {
        "asOfET": as_of_et,
        "asOfISO": now.isoformat(),
        "disclaimer": DISCLAIMER,
        "source": SOURCE,
        "stalePct": stale_pct,
        "builtFrom": source,
        "universe": {
            "queried": universe.get("queried"),
            "eligible": universe.get("eligible"),
            "used": universe.get("used"),
            "cache": universe.get("cache"),
        },
        "tickers": tickers_out,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.name + ".tmp")
    # Compact JSON: this file holds thousands of candles and is committed often.
    with tmp.open("w") as f:
        json.dump(payload, f, separators=(",", ":"))
        f.write("\n")
    tmp.replace(out)
    elapsed = time.time() - t0
    n_d = sum(len((t.get("candles") or {}).get("1d") or []) for t in tickers_out)
    n_h = sum(len((t.get("candles") or {}).get("1h") or []) for t in tickers_out)
    eprint(
        f"hl-smart build: wrote {out} ({len(tickers_out)} tickers, "
        f"{n_d} daily / {n_h} hourly candles, {source}, {elapsed:.1f}s) as of {as_of_et}"
    )
    if elapsed > 60:
        eprint(f"hl-smart build: warning, took {elapsed:.1f}s (target was under 60s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
