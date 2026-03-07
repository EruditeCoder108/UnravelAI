#!/bin/bash

# Ensure we're in the project root
cd "$(dirname "$0")/.."

echo "═══════════════════════════════════════════════════"
echo "  UNRAVEL CORE SYNC"
echo "  Synchronizing src/core/ from Web to VS Code"
echo "═══════════════════════════════════════════════════"

V3_CORE="unravel-v3/src/core"
VSCODE_CORE="unravel-vscode/src/core"

if [ ! -d "$V3_CORE" ]; then
  echo "❌ Error: $V3_CORE does not exist."
  exit 1
fi

if [ ! -d "$VSCODE_CORE" ]; then
  echo "❌ Error: $VSCODE_CORE does not exist."
  exit 1
fi

# Files that should be identical between the two projects
CORE_FILES=("config.js" "provider.js" "ast-engine.js" "orchestrate.js" "parse-json.js" "index.js")

for file in "${CORE_FILES[@]}"; do
  if [ -f "$V3_CORE/$file" ]; then
    cp "$V3_CORE/$file" "$VSCODE_CORE/$file"
    echo "✅ Synced: $file"
  else
    echo "⚠️ Warning: $file missing in $V3_CORE"
  fi
done

echo ""
echo "Done! The VS Code extension is now running the latest engine."
