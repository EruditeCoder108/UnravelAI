# sync-core.ps1
# Syncs shared core engine files from unravel-v3 → unravel-vscode.
#
# File classification:
#   SYNC       — identical logic required in both platforms
#   WEB-ONLY   — browser/Vite/IDB specific, skip (no vscode copy)
#   VSCODE-ONLY — different implementation in extension, skip (don't overwrite)
#
# Usage (run from the UnravelAI root directory):
#   .\sync-core.ps1           dry-run, shows what would change
#   .\sync-core.ps1 -Apply    actually copies files

param([switch]$Apply)

$ROOT = $PSScriptRoot
$SRC  = Join-Path $ROOT "unravel-v3\src\core"
$DEST = Join-Path $ROOT "unravel-vscode\src\core"

# ── SYNC: shared engine logic, must stay identical in both ────────────────────
$SYNC_FILES = "orchestrate.js",    # Analysis pipeline — phases, checks, confidence
              "config.js",         # Prompts, phases, schema, anti-sycophancy rules
              "ast-engine-ts.js",  # WASM AST detectors (forEach, listener, closure)
              "ast-project.js",    # Cross-file AST analysis
              "search.js",         # KG graph traversal & queryGraphForFiles
              "graph-builder.js",  # KG data model + addCallEdge
              "parse-json.js",     # Robust AI JSON parser
              "provider.js",       # callProvider / callProviderStreaming
              "graph-storage.js",  # KG persistence (Node.js fs + IndexedDB, both platforms)
              "ast-bridge.js",     # Pure-JS regex structural extractor (shared fallback)
              "layer-detector.js", # Layer classification (API/UI/Data/etc.)
              "pattern-store.js"   # Structural bug pattern store — used by orchestrate.js (Phase 1e)

# ── WEB-ONLY: browser/Vite env — no copy to extension ────────────────────────
# ast-bridge-browser.js  WASM structural extractor — extension uses ast-bridge.js regex fallback
# graph-storage-idb.js   (not a separate file — IDB code is inside graph-storage.js)
# sidebar-ref.js         React sidebar ref — extension has no React UI

# ── VSCODE-ONLY: extension-specific implementations ───────────────────────────
# llm-analyzer.js  CJS module (vscode) vs ESM (v3) — same logic, different module format
# indexer.js       Filesystem walker + KG builder — works in both but vscode-centric
# index.js         Different barrel exports per platform

# ── Run ───────────────────────────────────────────────────────────────────────
$changed  = 0
$inSync   = 0
$srcMiss  = 0
$destMiss = 0

Write-Host ""
Write-Host "=== Unravel Core Sync ===" -ForegroundColor Cyan
Write-Host "SRC : $SRC"
Write-Host "DEST: $DEST"
Write-Host "Mode: $(if ($Apply) { 'APPLY' } else { 'DRY-RUN  (-Apply to copy)' })" -ForegroundColor Yellow
Write-Host ""

foreach ($file in $SYNC_FILES) {
    $srcPath  = Join-Path $SRC  $file
    $destPath = Join-Path $DEST $file

    if (-not (Test-Path $srcPath)) {
        Write-Host "  [MISSING-SRC]  $file" -ForegroundColor Red
        $srcMiss++
        continue
    }

    $srcContent  = (Get-Content $srcPath  -Raw) -replace "`r",""
    $destContent = if (Test-Path $destPath) { (Get-Content $destPath -Raw) -replace "`r","" } else { $null }

    if ($null -eq $destContent) {
        $srcLines = ($srcContent -split "`n").Count
        Write-Host "  [NEW-IN-DEST]  $file  ($srcLines lines)" -ForegroundColor Magenta
        if ($Apply) { Copy-Item $srcPath $destPath -Force }
        $destMiss++
        $changed++
    } elseif ($srcContent -eq $destContent) {
        Write-Host "  [OK]           $file" -ForegroundColor Green
        $inSync++
    } else {
        $srcLines  = ($srcContent   -split "`n").Count
        $destLines = ($destContent  -split "`n").Count
        $delta     = $srcLines - $destLines
        $sign      = if ($delta -ge 0) { "+" } else { "" }
        Write-Host ("  [SYNC]         {0,-30} ({1} → {2} lines, {3}{4})" -f $file, $destLines, $srcLines, $sign, $delta) -ForegroundColor Yellow
        if ($Apply) { Copy-Item $srcPath $destPath -Force }
        $changed++
    }
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "  In sync : $inSync" -ForegroundColor Green
Write-Host "  Updated : $changed$(if (-not $Apply -and $changed -gt 0) { '  (run with -Apply to copy)' })" -ForegroundColor $(if ($changed -gt 0) { 'Yellow' } else { 'Green' })
if ($srcMiss -gt 0) { Write-Host "  Missing : $srcMiss" -ForegroundColor Red }
Write-Host ""
