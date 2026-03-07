# ═══════════════════════════════════════════════════
# UNRAVEL — Core Engine Sync Check
# Verifies that unravel-v3/src/core/ and unravel-vscode/src/core/
# are byte-for-byte identical. Run before every VSIX build.
# ═══════════════════════════════════════════════════

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$webCore = Join-Path $root "unravel-v3\src\core"
$vscCore = Join-Path $root "unravel-vscode\src\core"

$files = @("config.js", "orchestrate.js", "ast-engine.js", "provider.js", "parse-json.js", "index.js")
$drifted = @()

foreach ($f in $files) {
    $web = Join-Path $webCore $f
    $vsc = Join-Path $vscCore $f

    if (-not (Test-Path $web)) { Write-Host "⚠️  MISSING in web: $f" -ForegroundColor Yellow; continue }
    if (-not (Test-Path $vsc)) { Write-Host "⚠️  MISSING in vscode: $f" -ForegroundColor Yellow; continue }

    $webHash = (Get-FileHash $web -Algorithm SHA256).Hash
    $vscHash = (Get-FileHash $vsc -Algorithm SHA256).Hash

    if ($webHash -eq $vscHash) {
        Write-Host "✅ $f" -ForegroundColor Green
    } else {
        Write-Host "❌ $f — OUT OF SYNC" -ForegroundColor Red
        $drifted += $f
    }
}

Write-Host ""
if ($drifted.Count -eq 0) {
    Write-Host "All core files are in sync. Safe to build VSIX." -ForegroundColor Green
} else {
    Write-Host "$($drifted.Count) file(s) drifted. Run:" -ForegroundColor Red
    foreach ($f in $drifted) {
        Write-Host "  Copy-Item `"$webCore\$f`" `"$vscCore\$f`" -Force" -ForegroundColor Yellow
    }
    exit 1
}
