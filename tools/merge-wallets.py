#!/usr/bin/env python3
"""Merge wallets from data/smart-money.json smartFlows into data/smart-wallets.json.

Merge rule (idempotent per snapshot):
- Key = GMGN's shortened wallet "prefix…suffix" (either "…" or "..."), or walletFull[:4]…walletFull[-4:].
- A wallet's counters (snapshots, buys, sells, buyUsd, tokens) change at most once per
  snapshot asOfISO (tracked in lastSnapshotISO), so re-running on the same snapshot is a no-op.
- walletFull is only set from a real full address (a flow row's optional "walletFull" field,
  or one already in the file). It is never guessed here.
- New wallets get firstSeen = the snapshot time and label "GMGN smart inflow".
- The list is re-ranked by snapshots, buys, distinct tokens, buy USD and capped at 50.
"""
import json, re, sys
from datetime import datetime, timezone, timedelta
CAP = 50
B58 = r"[1-9A-HJ-NP-Za-km-z]"
snap = json.load(open("data/smart-money.json"))
try:
    store = json.load(open("data/smart-wallets.json"))
except FileNotFoundError:
    store = {"wallets": []}
iso, et = snap.get("asOfISO"), snap.get("asOfET")
by = {w["wallet"]: w for w in store.get("wallets", [])}
touched = set()
for f in snap.get("smartFlows", []):
    raw = (f.get("wallet") or "").strip()
    full = f.get("walletFull") if re.fullmatch(B58 + "{32,44}", f.get("walletFull") or "") else None
    m = re.fullmatch(r"(" + B58 + r"{3,6})\s*(?:…|\.\.\.)\s*(" + B58 + r"{3,6})", raw)
    if full: pre, suf = full[:4], full[-4:]
    elif m: pre, suf = m.group(1), m.group(2)
    else: continue
    key = pre + "…" + suf
    w = by.get(key)
    if w is None:
        w = by[key] = {"wallet": key, "prefix": pre, "suffix": suf, "walletFull": None, "resolvedBy": None,
                       "label": "GMGN smart inflow", "firstSeenISO": iso, "firstSeenET": et,
                       "lastSeenISO": iso, "lastSeenET": et, "lastSnapshotISO": None,
                       "snapshots": 0, "buys": 0, "sells": 0, "buyUsd": 0.0, "tokens": []}
    if full and not w.get("walletFull"):
        w["walletFull"], w["resolvedBy"] = full, "GMGN"
    if w.get("lastSnapshotISO") == iso and key not in touched:
        continue  # this snapshot was already merged for this wallet
    if key not in touched:
        w["snapshots"] = w.get("snapshots", 0) + 1
        touched.add(key)
    w["lastSeenISO"], w["lastSeenET"], w["lastSnapshotISO"] = iso, et, iso
    a = f.get("action", "")
    if a in ("First Buy", "Buy More"):
        w["buys"] += 1; w["buyUsd"] = round(w.get("buyUsd", 0) + abs(f.get("usd") or 0), 2)
    elif a.startswith("Sell"):
        w["sells"] += 1
    t = f.get("token")
    if t and t not in w["tokens"]:
        w["tokens"].append(t)
rows = sorted(by.values(), key=lambda e: (-e.get("snapshots", 0), -e.get("buys", 0), -len(e.get("tokens", [])), -e.get("buyUsd", 0)))[:CAP]
now = datetime.now(timezone(timedelta(hours=-5)))
store.update({"updatedET": now.strftime("%-I:%M %p ET, %b %-d, %Y"), "updatedISO": now.isoformat(timespec="seconds"), "cap": CAP, "wallets": rows})
json.dump(store, open("data/smart-wallets.json", "w"), ensure_ascii=False, indent=1)
print(f"smart-wallets: {len(rows)} wallets, {len(touched)} updated from snapshot {et}")
