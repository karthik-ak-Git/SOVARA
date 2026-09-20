Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "      Downloading Sovara (Local AI Agent)    " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

try {
    Write-Host "Fetching release data from GitHub (Sovara-versions)..." -ForegroundColor Yellow
    $api = "https://api.github.com/repos/karthik-ak-Git/SOVARA/releases/tags/Sovara-versions"
    $release = Invoke-RestMethod -Uri $api -UseBasicParsing
    
    $asset = $release.assets | Where-Object { $_.name -match '\.exe$' } | Select-Object -First 1

    if (!$asset) {
        Write-Host "Error: Could not find a Windows .exe installer in the latest release." -ForegroundColor Red
        exit
    }

    $outFile = "$env:TEMP\$($asset.name)"
    
    Write-Host "Downloading $($asset.name) (" ([math]::Round($asset.size / 1MB, 2)) "MB)..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $outFile -UseBasicParsing

    Write-Host "Download complete! Launching installer..." -ForegroundColor Green
    Start-Process -FilePath $outFile

    Write-Host ""
    Write-Host "Setup is now running. You can close this window." -ForegroundColor Cyan
} catch {
    Write-Host "An error occurred during installation: $_" -ForegroundColor Red
}
