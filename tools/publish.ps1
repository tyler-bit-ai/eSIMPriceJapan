param(
  [string]$OutDir = '.\out',
  [string]$DataDir = 'dashboard\data',
  [string]$Site = 'amazon_jp',
  [string]$Country = 'kr',
  [string]$Query = '',
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

function New-Record(
  [string]$SiteValue,
  [string]$CountryValue,
  [string]$CsvValue,
  [string]$JsonlValue,
  [string]$MetadataValue,
  [string]$SourceValue,
  [string]$CrawledAtValue,
  [string]$PublishedAtValue,
  $ItemCountValue,
  [string]$QueryValue,
  $LimitValue
) {
  return [ordered]@{
    site = $SiteValue
    country = $CountryValue
    csv = $CsvValue
    jsonl = $JsonlValue
    metadata = $MetadataValue
    source = $SourceValue
    crawled_at = $CrawledAtValue
    published_at = $PublishedAtValue
    item_count = $ItemCountValue
    query = $QueryValue
    limit = $LimitValue
  }
}

function Convert-ToRecord($Value, [string]$FallbackSite, [string]$FallbackCountry) {
  if ($null -eq $Value) { return $null }
  $csvValue = [string]$Value.csv
  $jsonlValue = [string]$Value.jsonl
  if ([string]::IsNullOrWhiteSpace($csvValue) -or [string]::IsNullOrWhiteSpace($jsonlValue)) {
    return $null
  }
  return (New-Record `
    (if ($Value.site) { [string]$Value.site } else { $FallbackSite }) `
    (if ($Value.country) { [string]$Value.country } else { $FallbackCountry }) `
    $csvValue `
    $jsonlValue `
    ([string]$Value.metadata) `
    ([string]$Value.source) `
    ([string]$Value.crawled_at) `
    ([string]$Value.published_at) `
    (if ($null -ne $Value.item_count) { [int]$Value.item_count } else { $null }) `
    ([string]$Value.query) `
    (if ($null -ne $Value.limit) { [int]$Value.limit } else { 0 }))
}

function Normalize-LatestMap($LatestValue) {
  $map = [ordered]@{}
  if ($null -eq $LatestValue) { return $map }

  $topKeys = @($LatestValue.Keys)
  $isFlatLegacy = ($topKeys -contains 'csv') -and ($topKeys -contains 'jsonl')
  if ($isFlatLegacy) {
    $record = Convert-ToRecord $LatestValue 'amazon_jp' 'kr'
    if ($null -ne $record) {
      $map['amazon_jp'] = [ordered]@{ kr = $record }
    }
    return $map
  }

  foreach ($siteKey in $topKeys) {
    $siteValue = $LatestValue[$siteKey]
    if ($null -eq $siteValue) { continue }
    $siteKeys = @($siteValue.Keys)
    $isSiteLegacy = ($siteKeys -contains 'csv') -and ($siteKeys -contains 'jsonl')
    if ($isSiteLegacy) {
      $record = Convert-ToRecord $siteValue $siteKey 'kr'
      if ($null -ne $record) {
        $map[$siteKey] = [ordered]@{ kr = $record }
      }
      continue
    }

    $countryMap = [ordered]@{}
    foreach ($countryKey in $siteKeys) {
      $record = Convert-ToRecord $siteValue[$countryKey] $siteKey $countryKey
      if ($null -ne $record) {
        $countryMap[$countryKey] = $record
      }
    }
    if ($countryMap.Count -gt 0) {
      $map[$siteKey] = $countryMap
    }
  }

  return $map
}

function Normalize-Runs($RunsValue, [string]$CurrentRunId) {
  $normalized = @()
  if ($null -eq $RunsValue) { return $normalized }
  foreach ($run in $RunsValue) {
    if ([string]$run.id -eq $CurrentRunId) { continue }
    $normalized += [ordered]@{
      id = [string]$run.id
      site = if ($run.site) { [string]$run.site } else { 'amazon_jp' }
      country = if ($run.country) { [string]$run.country } else { 'kr' }
      label = [string]$run.label
      source = [string]$run.source
      crawled_at = [string]$run.crawled_at
      published_at = [string]$run.published_at
      item_count = if ($null -ne $run.item_count) { [int]$run.item_count } else { $null }
      csv = [string]$run.csv
      jsonl = [string]$run.jsonl
      metadata = [string]$run.metadata
      query = [string]$run.query
      limit = if ($null -ne $run.limit) { [int]$run.limit } else { 0 }
    }
  }
  return $normalized
}

New-Item -ItemType Directory -Force $DataDir | Out-Null
$runsDir = Join-Path $DataDir 'runs'
New-Item -ItemType Directory -Force $runsDir | Out-Null
$countryDir = Join-Path (Join-Path $DataDir (Join-Path 'sites' $Site)) $Country
New-Item -ItemType Directory -Force $countryDir | Out-Null

$outName = (Split-Path $OutDir -Leaf) -replace '[^a-zA-Z0-9._-]', '_'
$jsonlInfo = Get-Item $resultsJsonl
$crawledAt = $jsonlInfo.LastWriteTimeUtc.ToString('o')
$publishedAt = (Get-Date).ToUniversalTime().ToString('o')
$runTs = $jsonlInfo.LastWriteTimeUtc.ToString('yyyyMMddTHHmmssZ')
$runId = "${runTs}_${Site}_${Country}_${outName}"
$lineCount = (Get-Content $resultsJsonl | Where-Object { $_.Trim() -ne '' } | Measure-Object -Line).Lines

$runCsvName = "${runId}.csv"
$runJsonlName = "${runId}.jsonl"
Copy-Item $results (Join-Path $runsDir $runCsvName) -Force
Copy-Item $resultsJsonl (Join-Path $runsDir $runJsonlName) -Force

$destCsv = Join-Path $countryDir 'latest.csv'
$destJsonl = Join-Path $countryDir 'latest.jsonl'
Copy-Item $results $destCsv -Force
Copy-Item $resultsJsonl $destJsonl -Force

$meta = [ordered]@{
  site = $Site
  country = $Country
  query = $Query
  limit = $Limit
  source = $resultsJsonl
  crawled_at = $crawledAt
  published_at = $publishedAt
  item_count = $lineCount
}
$metaPath = Join-Path $countryDir 'metadata.json'
$meta | ConvertTo-Json | Set-Content -Path $metaPath -Encoding UTF8

$indexPath = Join-Path $DataDir 'index.json'
$latestMap = [ordered]@{}
$runs = @()
if (Test-Path $indexPath) {
  try {
    $existing = Get-Content $indexPath -Raw | ConvertFrom-Json -AsHashtable
    $latestMap = Normalize-LatestMap $existing.latest
    $runs = Normalize-Runs $existing.runs $runId
  } catch {
    $latestMap = [ordered]@{}
    $runs = @()
  }
}

if (-not $latestMap.Contains($Site)) {
  $latestMap[$Site] = [ordered]@{}
}

$latestMap[$Site][$Country] = New-Record `
  $Site `
  $Country `
  ('sites/{0}/{1}/latest.csv' -f $Site, $Country) `
  ('sites/{0}/{1}/latest.jsonl' -f $Site, $Country) `
  ('sites/{0}/{1}/metadata.json' -f $Site, $Country) `
  $resultsJsonl `
  $crawledAt `
  $publishedAt `
  $lineCount `
  $Query `
  $Limit

$label = "{0} | {1} | {2} | {3} | {4} items" -f $jsonlInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm'), $Site, $Country, $outName, $lineCount
$newRun = [ordered]@{
  id = $runId
  site = $Site
  country = $Country
  label = $label
  source = $resultsJsonl
  crawled_at = $crawledAt
  published_at = $publishedAt
  item_count = $lineCount
  csv = ('runs/{0}' -f $runCsvName)
  jsonl = ('runs/{0}' -f $runJsonlName)
  metadata = ('sites/{0}/{1}/metadata.json' -f $Site, $Country)
  query = $Query
  limit = $Limit
}
$runs = @($newRun) + $runs

$indexObj = [ordered]@{
  latest = $latestMap
  runs = $runs
}
$indexObj | ConvertTo-Json -Depth 10 | Set-Content -Path $indexPath -Encoding UTF8

Write-Host "Copied $results -> $destCsv"
Write-Host "Copied $resultsJsonl -> $destJsonl"
Write-Host "Wrote metadata -> $metaPath"
Write-Host "Saved run -> $runId"
Write-Host "Updated index -> $indexPath"
