$repoDir = "D:\WORK-TEAM"
if (Test-Path "$PSScriptRoot\..\apps\desktop\scripts\launch.js") {
    $repoDir = (Resolve-Path "$PSScriptRoot\..").Path
}

Set-Location $repoDir
Write-Host "[Union Bot] Dang khoi dong Union Bot Desktop..." -ForegroundColor Cyan
node apps/desktop/scripts/launch.js @args
