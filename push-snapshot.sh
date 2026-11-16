#!/usr/bin/env bash
# Merge new GMGN wallets into data/smart-wallets.json, then commit data/smart-money.json and
# data/smart-wallets.json and push to main using $GH_TOKEN (never stored in .git/config).
set -euo pipefail
cd "$(dirname "$0")"
[ -n "${GH_TOKEN:-}" ] || { echo "GH_TOKEN not set" >&2; exit 1; }
python3 -c "import json;json.load(open('data/smart-money.json'))" || { echo "invalid JSON" >&2; exit 1; }
python3 tools/merge-wallets.py
AS_OF=$(python3 -c "import json;s=json.load(open('data/smart-money.json')).get('asOfET','unknown').strip();print(s if 'ET' in s.split() or s.endswith(' ET') or ' ET,' in s else s+' ET')")
git config user.name >/dev/null || git config user.name "Randec123"
git config user.email >/dev/null || git config user.email "350354584+Randec123@users.noreply.github.com"
git add data/smart-money.json data/smart-wallets.json
if git diff --cached --quiet; then echo "No changes to data files"; exit 0; fi
git commit -q -m "Refresh GMGN smart-money snapshot (as of ${AS_OF})"
AUTH=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)
git -c http.extraheader="AUTHORIZATION: basic ${AUTH}" pull -q --rebase origin main
git -c http.extraheader="AUTHORIZATION: basic ${AUTH}" push -q origin HEAD:main
echo "Pushed snapshot as of ${AS_OF}"
