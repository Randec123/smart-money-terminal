#!/usr/bin/env bash
# Merge new GMGN wallets, refresh the Hyperliquid stock-perp snapshot, then commit
# data/smart-money.json, data/smart-wallets.json, data/hl-smart.json and (when
# changed) data/gmgn-top-wallets.json and push to main using $GH_TOKEN (never stored in .git/config).
set -euo pipefail
cd "$(dirname "$0")"
[ -n "${GH_TOKEN:-}" ] || { echo "GH_TOKEN not set" >&2; exit 1; }
python3 -c "import json;json.load(open('data/smart-money.json'))" || { echo "invalid JSON" >&2; exit 1; }
python3 tools/merge-wallets.py
FILES="data/smart-money.json data/smart-wallets.json"
if [ -f data/gmgn-top-wallets.json ]; then
  python3 - <<'PYCHK' || { echo "invalid data/gmgn-top-wallets.json" >&2; exit 1; }
import json, re
w = json.load(open("data/gmgn-top-wallets.json"))["wallets"]
assert 1 <= len(w) <= 15 and all(re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]{32,44}", x["walletFull"]) for x in w)
PYCHK
  FILES="$FILES data/gmgn-top-wallets.json"
fi
# Hyperliquid xyz stock-perp snapshot. Best-effort: a failed build keeps the
# last good file and does not block the GMGN push.
if python3 tools/build-hl-smart.py && python3 - <<'PYHL'
import json
d = json.load(open("data/hl-smart.json"))
assert d.get("asOfET") and isinstance(d.get("tickers"), list) and d["tickers"]
PYHL
then
  FILES="$FILES data/hl-smart.json"
else
  echo "hl-smart refresh skipped or invalid; not staging a new file" >&2
  if [ -f data/hl-smart.json ] && python3 -c "import json;d=json.load(open('data/hl-smart.json'));assert d.get('tickers')"; then
    FILES="$FILES data/hl-smart.json"
  fi
fi
AS_OF=$(python3 - <<'PYASOF'
import json
from pathlib import Path
s = json.load(open("data/smart-money.json")).get("asOfET", "unknown")
s = s.strip() if isinstance(s, str) else "unknown"
if "ET" not in s.split() and not s.endswith(" ET") and " ET," not in s:
    s = s + " ET"
hl = Path("data/hl-smart.json")
if hl.exists():
    try:
        h = json.load(open(hl)).get("asOfET") or ""
        if h:
            s = h if "ET" in h else h + " ET"
    except Exception:
        pass
print(s)
PYASOF
)
git config user.name >/dev/null || git config user.name "Randec123"
git config user.email >/dev/null || git config user.email "350354584+Randec123@users.noreply.github.com"
git add $FILES
if git diff --cached --quiet; then echo "No changes to data files"; exit 0; fi
git commit -q -m "Refresh Terminal snapshots (as of ${AS_OF})"
AUTH=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)
git -c http.extraheader="AUTHORIZATION: basic ${AUTH}" pull -q --rebase origin main
git -c http.extraheader="AUTHORIZATION: basic ${AUTH}" push -q origin HEAD:main
echo "Pushed snapshot as of ${AS_OF}"
