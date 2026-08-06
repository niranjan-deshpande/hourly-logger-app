#!/bin/bash
# One-shot: write the phone-relay URL + token into the Mac app's
# settings.json. Run while Hourly Logger is QUIT (the app caches settings
# in memory and would overwrite this on its next write).
#
#   ./configure-mac.sh <relay-url> <relay-token>
set -euo pipefail

URL="${1:?usage: ./configure-mac.sh <relay-url> <relay-token>}"
TOKEN="${2:?usage: ./configure-mac.sh <relay-url> <relay-token>}"
SETTINGS="$HOME/Library/Application Support/HourlyLogger/settings.json"

if pgrep -x "Hourly Logger" > /dev/null; then
  echo "Hourly Logger is running — quit it first, then re-run this." >&2
  exit 1
fi
if [ ! -f "$SETTINGS" ]; then
  echo "No settings.json at $SETTINGS — launch the app once first." >&2
  exit 1
fi

node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const s = JSON.parse(fs.readFileSync(p, "utf8"));
  s.phoneRelayEnabled = true;
  s.phoneRelayUrl = process.argv[2];
  s.phoneRelayToken = process.argv[3];
  fs.writeFileSync(p, JSON.stringify(s, null, 2));
' "$SETTINGS" "$URL" "$TOKEN"

echo "Done — phone relay configured. Open Hourly Logger."
