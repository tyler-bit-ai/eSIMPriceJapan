param(
  [string]$OutDir = '.\out',
  [string]$DataDir = 'dashboard\data'
)

$results = Join-Path $OutDir 'results.csv'
if (-not (Test-Path $results)) {
  Write-Error "results.csv not found in $OutDir"
  exit 1
}

New-Item -ItemType Directory -Force $DataDir | Out-Null
$dest = Join-Path $DataDir 'latest.csv'
Copy-Item $results $dest -Force
Write-Host "Copied $results -> $dest"
