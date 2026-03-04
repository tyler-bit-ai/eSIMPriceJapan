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
$lineCount = (Get-Content $resultsJsonl | Where-Object { $_.Trim() -ne '' } | Measure-Object -Line).Lines
$crawledAt = (Get-Item $resultsJsonl).LastWriteTimeUtc.ToString('o')
$publishedAt = (Get-Date).ToUniversalTime().ToString('o')
$meta = @{
  source = $resultsJsonl
  crawled_at = $crawledAt
  published_at = $publishedAt
  item_count = $lineCount
}
$metaPath = Join-Path $DataDir 'metadata.json'
$meta | ConvertTo-Json | Set-Content -Path $metaPath -Encoding UTF8
Write-Host "Copied $results -> $dest"
Write-Host "Copied $resultsJsonl -> $destJsonl"
Write-Host "Wrote metadata -> $metaPath"
