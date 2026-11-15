#!/usr/bin/env bash
# Commit data/smart-money.json and push to main using $GH_TOKEN (never stored in .git/config).
set -euo pipefail
cd "$(dirname "$0")"
[ -n "${GH_TOKEN:-}" ] || { echo "GH_TOKEN not set" >&2; exit 1; }
python3 -c "import json;json.load(open('data/smart-money.json'))" || { echo "invalid JSON" >&2; exit 1; }
AS_OF=$(python3 -c "import json;print(json.load(open('data/smart-money.json')).get('asOfET','unknown').removesuffix(' ET'))")
git config user.name >/dev/null || git config user.name "Randec123"
git config user.email >/dev/null || git config user.email "350354584+Randec123@users.noreply.github.com"
git add data/smart-money.json
if git diff --cached --quiet; then echo "No changes to data/smart-money.json"; exit 0; fi
git commit -q -m "Refresh GMGN smart-money snapshot (as of ${AS_OF} ET)"
AUTH=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)
git -c http.extraheader="AUTHORIZATION: basic ${AUTH}" pull -q --rebase origin main
git -c http.extraheader="AUTHORIZATION: basic ${AUTH}" push -q origin HEAD:main
echo "Pushed snapshot as of ${AS_OF} ET"
