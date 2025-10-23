$ErrorActionPreference = 'Stop'
Write-Output "Starting elevated build script..."
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
Set-Location 'C:\Users\USER\Desktop\Responsive Soccer Lineup Display'

# Remove electron-builder cache to force fresh download
$cachePath = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache'
if (Test-Path $cachePath) {
  Write-Output "Removing cache: $cachePath"
  Remove-Item -Recurse -Force $cachePath
}

Write-Output "node version: $(node --version)"
Write-Output "npm version: $(npm --version)"

# Run build and capture output
$log = Join-Path (Get-Location) 'build_elevated.log'
Write-Output "Logging to: $log"

# Execute build and redirect output
npm run electron:build *>&1 | Tee-Object -FilePath $log

Write-Output "Elevated build script finished. See log: $log"
