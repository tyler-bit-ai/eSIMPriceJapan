param(
  [string]$OutDir = '.\out',
  [string]$DataDir = 'dashboard\data'
)

$results = Join-Path $OutDir 'results.csv'
if (-not (Test-Path $results)) {
  Write-Error "results.csv not found in $OutDir"
  exit 1
}
$resultsJsonl = Join-Path $OutDir 'results.jsonl'
if (-not (Test-Path $resultsJsonl)) {
  Write-Error "results.jsonl not found in $OutDir"
  exit 1
}

New-Item -ItemType Directory -Force $DataDir | Out-Null
$dest = Join-Path $DataDir 'latest.csv'
Copy-Item $results $dest -Force
$destJsonl = Join-Path $DataDir 'latest.jsonl'
Copy-Item $resultsJsonl $destJsonl -Force
Write-Host "Copied $results -> $dest"
Write-Host "Copied $resultsJsonl -> $destJsonl"
