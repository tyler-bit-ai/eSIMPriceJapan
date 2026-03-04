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
$runsDir = Join-Path $DataDir 'runs'
New-Item -ItemType Directory -Force $runsDir | Out-Null

$outName = (Split-Path $OutDir -Leaf) -replace '[^a-zA-Z0-9._-]', '_'
$jsonlInfo = Get-Item $resultsJsonl
$crawledAt = $jsonlInfo.LastWriteTimeUtc.ToString('o')
$publishedAt = (Get-Date).ToUniversalTime().ToString('o')
$runTs = $jsonlInfo.LastWriteTimeUtc.ToString('yyyyMMddTHHmmssZ')
$runId = "${runTs}_${outName}"
$lineCount = (Get-Content $resultsJsonl | Where-Object { $_.Trim() -ne '' } | Measure-Object -Line).Lines

$runCsvName = "${runId}.csv"
$runJsonlName = "${runId}.jsonl"
$runCsvPath = Join-Path $runsDir $runCsvName
$runJsonlPath = Join-Path $runsDir $runJsonlName
Copy-Item $results $runCsvPath -Force
Copy-Item $resultsJsonl $runJsonlPath -Force

$dest = Join-Path $DataDir 'latest.csv'
Copy-Item $results $dest -Force
$destJsonl = Join-Path $DataDir 'latest.jsonl'
Copy-Item $resultsJsonl $destJsonl -Force

$meta = @{
  source = $resultsJsonl
  crawled_at = $crawledAt
  published_at = $publishedAt
  item_count = $lineCount
}
$metaPath = Join-Path $DataDir 'metadata.json'
$meta | ConvertTo-Json | Set-Content -Path $metaPath -Encoding UTF8

$indexPath = Join-Path $DataDir 'index.json'
$runs = @()
if (Test-Path $indexPath) {
  try {
    $existing = Get-Content $indexPath -Raw | ConvertFrom-Json
    if ($existing -and $existing.runs) {
      foreach ($r in $existing.runs) {
        if ($r.id -ne $runId) {
          $runs += [ordered]@{
            id = [string]$r.id
            label = [string]$r.label
            source = [string]$r.source
            crawled_at = [string]$r.crawled_at
            published_at = [string]$r.published_at
            item_count = [int]$r.item_count
            csv = [string]$r.csv
            jsonl = [string]$r.jsonl
            metadata = [string]$r.metadata
          }
        }
      }
    }
  } catch {
    $runs = @()
  }
}

$label = "{0} | {1} | {2} items" -f $jsonlInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm'), $outName, $lineCount
$newRun = [ordered]@{
  id = $runId
  label = $label
  source = $resultsJsonl
  crawled_at = $crawledAt
  published_at = $publishedAt
  item_count = $lineCount
  csv = ('runs/{0}' -f $runCsvName)
  jsonl = ('runs/{0}' -f $runJsonlName)
  metadata = 'metadata.json'
}
$runs = @($newRun) + $runs

$indexObj = [ordered]@{
  latest = [ordered]@{
    csv = 'latest.csv'
    jsonl = 'latest.jsonl'
    metadata = 'metadata.json'
  }
  runs = $runs
}
$indexObj | ConvertTo-Json -Depth 6 | Set-Content -Path $indexPath -Encoding UTF8

Write-Host "Copied $results -> $dest"
Write-Host "Copied $resultsJsonl -> $destJsonl"
Write-Host "Wrote metadata -> $metaPath"
Write-Host "Saved run -> $runId"
Write-Host "Updated index -> $indexPath"
