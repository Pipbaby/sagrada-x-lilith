#!/bin/sh
# Starts Sagrada x Lilith on this computer and opens it in your browser (macOS: double-click;
# Linux: sh "Start Sagrada x Lilith.command"). Close the window or press Ctrl+C to stop it.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Sagrada x Lilith needs Node.js 20 or newer, which is free."
  echo "Install the LTS version from https://nodejs.org, then start this again."
  (open https://nodejs.org/ || xdg-open https://nodejs.org/) >/dev/null 2>&1
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "First start: installing the parts it needs. This takes a minute, once."
  npm install --no-audit --no-fund || exit 1
fi
exec node server.mjs --open
