Write-Host ""
$ProgressPreference = 'SilentlyContinue'

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "      Downloading Sovara (Local AI Agent)    " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

try {
    $api = "https://api.github.com/repos/karthik-ak-Git/SOVARA/releases/tags/Sovara-versions"
    $release = Invoke-RestMethod -Uri $api -UseBasicParsing

    $assets = @($release.assets | Where-Object { $_.name -match '\.exe$' })
    $asset = $assets |
        Where-Object { $_.name -match '(?i)sovara.*(setup|installer)' } |
        Select-Object -First 1
    if (!$asset) {
        $asset = $assets |
            Where-Object { $_.name -match '(?i)(setup|installer)' -and $_.name -notmatch '(?i)(blockmap|debug|update|helper)' } |
            Select-Object -First 1
    }
    if (!$asset) {
        $asset = $assets |
            Where-Object { $_.name -notmatch '(?i)(blockmap|debug|update|helper)' } |
            Select-Object -First 1
    }
    if (!$asset) {
        throw "No Windows installer asset was found in the latest Sovara release."
    }

    $safeName = [IO.Path]::GetFileName($asset.name) -replace '[^a-zA-Z0-9._-]', '_'
    $outFile = Join-Path $env:TEMP $safeName
    $sizeMB = [math]::Round($asset.size / 1MB, 2)
    Write-Host "Release asset: $($asset.name) ($sizeMB MB)" -ForegroundColor Yellow
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $outFile -UseBasicParsing

    if ($asset.digest -and $asset.digest -match '^sha256:(.+)$') {
        $expected = $Matches[1].ToLowerInvariant()
        $actual = (Get-FileHash -LiteralPath $outFile -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $expected) {
            Remove-Item -LiteralPath $outFile -Force -ErrorAction SilentlyContinue
            throw "Installer checksum mismatch. Expected $expected, got $actual."
        }
        Write-Host "Verified SHA-256: $actual" -ForegroundColor Green
    }

    Write-Host "Launching installer..." -ForegroundColor Green
    Start-Process -FilePath $outFile
    Write-Host ""
    Write-Host "Setup is now running. You can close this window." -ForegroundColor Cyan
} catch {
    Write-Host "Installation failed: $_" -ForegroundColor Red
    exit 1
}
