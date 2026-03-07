param(
  [string]$OutDir = '.\out',
  [string]$DataDir = 'dashboard\data',
  [string]$Site = 'amazon_jp',
  [string]$Query = 'eSIM 韓国',
  [int]$Limit = 0
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
$siteDir = Join-Path $DataDir (Join-Path 'sites' $Site)
New-Item -ItemType Directory -Force $siteDir | Out-Null

$outName = (Split-Path $OutDir -Leaf) -replace '[^a-zA-Z0-9._-]', '_'
$jsonlInfo = Get-Item $resultsJsonl
$crawledAt = $jsonlInfo.LastWriteTimeUtc.ToString('o')
$publishedAt = (Get-Date).ToUniversalTime().ToString('o')
$runTs = $jsonlInfo.LastWriteTimeUtc.ToString('yyyyMMddTHHmmssZ')
$runId = "${runTs}_${Site}_${outName}"
$lineCount = (Get-Content $resultsJsonl | Where-Object { $_.Trim() -ne '' } | Measure-Object -Line).Lines

$runCsvName = "${runId}.csv"
$runJsonlName = "${runId}.jsonl"
$runCsvPath = Join-Path $runsDir $runCsvName
$runJsonlPath = Join-Path $runsDir $runJsonlName
Copy-Item $results $runCsvPath -Force
Copy-Item $resultsJsonl $runJsonlPath -Force

$dest = Join-Path $siteDir 'latest.csv'
Copy-Item $results $dest -Force
$destJsonl = Join-Path $siteDir 'latest.jsonl'
Copy-Item $resultsJsonl $destJsonl -Force

$meta = [ordered]@{
  site = $Site
  query = $Query
  limit = $Limit
  source = $resultsJsonl
  crawled_at = $crawledAt
  published_at = $publishedAt
  item_count = $lineCount
}
$metaPath = Join-Path $siteDir 'metadata.json'
$meta | ConvertTo-Json | Set-Content -Path $metaPath -Encoding UTF8

$indexPath = Join-Path $DataDir 'index.json'
$latestMap = [ordered]@{}
$runs = @()
if (Test-Path $indexPath) {
  try {
    $existing = Get-Content $indexPath -Raw | ConvertFrom-Json
    if ($existing -and $existing.latest) {
      $latestProps = @($existing.latest.PSObject.Properties.Name)
      $isLegacyLatest = $latestProps -contains 'csv' -and $latestProps -contains 'jsonl'
      if ($isLegacyLatest) {
        $latestMap['amazon_jp'] = [ordered]@{
          site = 'amazon_jp'
          csv = [string]$existing.latest.csv
          jsonl = [string]$existing.latest.jsonl
          metadata = [string]$existing.latest.metadata
          source = ''
          crawled_at = ''
          published_at = ''
          item_count = $null
          query = ''
          limit = 0
        }
      } else {
        foreach ($p in $existing.latest.PSObject.Properties) {
          $csvValue = [string]$p.Value.csv
          if ([string]::IsNullOrWhiteSpace($csvValue) -or $csvValue.StartsWith('@{site=')) {
            continue
          }
          $latestMap[$p.Name] = [ordered]@{
            site = if ($p.Value.site) { [string]$p.Value.site } else { [string]$p.Name }
            csv = $csvValue
            jsonl = [string]$p.Value.jsonl
            metadata = [string]$p.Value.metadata
            source = [string]$p.Value.source
            crawled_at = [string]$p.Value.crawled_at
            published_at = [string]$p.Value.published_at
            item_count = if ($null -ne $p.Value.item_count) { [int]$p.Value.item_count } else { $null }
            query = [string]$p.Value.query
            limit = if ($null -ne $p.Value.limit) { [int]$p.Value.limit } else { 0 }
          }
        }
      }
    }
    if ($existing -and $existing.runs) {
      foreach ($r in $existing.runs) {
        if ($r.id -ne $runId) {
          $runs += [ordered]@{
            id = [string]$r.id
            site = if ($r.site) { [string]$r.site } else { 'amazon_jp' }
            label = [string]$r.label
            source = [string]$r.source
            crawled_at = [string]$r.crawled_at
            published_at = [string]$r.published_at
            item_count = [int]$r.item_count
            csv = [string]$r.csv
            jsonl = [string]$r.jsonl
            metadata = [string]$r.metadata
            query = [string]$r.query
            limit = if ($null -ne $r.limit) { [int]$r.limit } else { 0 }
          }
        }
      }
    }
  } catch {
    $latestMap = [ordered]@{}
    $runs = @()
  }
}

if (-not $latestMap.Contains('amazon_jp')) {
  $legacyLatestCsv = Join-Path $DataDir 'latest.csv'
  $legacyLatestJsonl = Join-Path $DataDir 'latest.jsonl'
  $legacyMetadata = Join-Path $DataDir 'metadata.json'
  if ((Test-Path $legacyLatestCsv) -and (Test-Path $legacyLatestJsonl)) {
    $latestMap['amazon_jp'] = [ordered]@{
      site = 'amazon_jp'
      csv = 'latest.csv'
      jsonl = 'latest.jsonl'
      metadata = if (Test-Path $legacyMetadata) { 'metadata.json' } else { '' }
      source = ''
      crawled_at = ''
      published_at = ''
      item_count = $null
      query = ''
      limit = 0
    }
  }
}

$latestMap[$Site] = [ordered]@{
  site = $Site
  csv = ('sites/{0}/latest.csv' -f $Site)
  jsonl = ('sites/{0}/latest.jsonl' -f $Site)
  metadata = ('sites/{0}/metadata.json' -f $Site)
  source = $resultsJsonl
  crawled_at = $crawledAt
  published_at = $publishedAt
  item_count = $lineCount
  query = $Query
  limit = $Limit
}

$label = "{0} | {1} | {2} | {3} items" -f $jsonlInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm'), $Site, $outName, $lineCount
$newRun = [ordered]@{
  id = $runId
  site = $Site
  label = $label
  source = $resultsJsonl
  crawled_at = $crawledAt
  published_at = $publishedAt
  item_count = $lineCount
  csv = ('runs/{0}' -f $runCsvName)
  jsonl = ('runs/{0}' -f $runJsonlName)
  metadata = ('sites/{0}/metadata.json' -f $Site)
  query = $Query
  limit = $Limit
}
$runs = @($newRun) + $runs

$indexObj = [ordered]@{
  latest = $latestMap
  runs = $runs
}
$indexObj | ConvertTo-Json -Depth 8 | Set-Content -Path $indexPath -Encoding UTF8

Write-Host "Copied $results -> $dest"
Write-Host "Copied $resultsJsonl -> $destJsonl"
Write-Host "Wrote metadata -> $metaPath"
Write-Host "Saved run -> $runId"
Write-Host "Updated index -> $indexPath"
