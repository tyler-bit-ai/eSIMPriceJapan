param(
  [string]$OutDir = '.\out',
  [string]$DataDir = 'dashboard\data',
  [string]$Site = 'amazon_jp',
  [string]$Country = 'kr',
  [string]$Query = '',
  [int]$Limit = 0
)

$ErrorActionPreference = 'Stop'

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

function Get-ObjectValue($Value, [string]$Key) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [System.Collections.IDictionary]) {
    if ($Value.Contains($Key)) {
      return $Value[$Key]
    }
    return $null
  }
  $prop = $Value.PSObject.Properties[$Key]
  if ($null -ne $prop) {
    return $prop.Value
  }
  return $null
}

function Convert-ToRecord($Value, [string]$FallbackSite, [string]$FallbackCountry) {
  if ($null -eq $Value) { return $null }
  $csvValue = [string](Get-ObjectValue $Value 'csv')
  $jsonlValue = [string](Get-ObjectValue $Value 'jsonl')
  if ([string]::IsNullOrWhiteSpace($csvValue) -or [string]::IsNullOrWhiteSpace($jsonlValue)) {
    return $null
  }
  $siteRaw = Get-ObjectValue $Value 'site'
  $countryRaw = Get-ObjectValue $Value 'country'
  $itemCountRaw = Get-ObjectValue $Value 'item_count'
  $limitRaw = Get-ObjectValue $Value 'limit'
  $siteValue = if ($siteRaw) { [string]$siteRaw } else { $FallbackSite }
  $countryValue = if ($countryRaw) { [string]$countryRaw } else { $FallbackCountry }
  $itemCountValue = if ($null -ne $itemCountRaw) { [int]$itemCountRaw } else { $null }
  $limitValue = if ($null -ne $limitRaw) { [int]$limitRaw } else { 0 }
  return (New-Record `
    $siteValue `
    $countryValue `
    $csvValue `
    $jsonlValue `
    ([string](Get-ObjectValue $Value 'metadata')) `
    ([string](Get-ObjectValue $Value 'source')) `
    ([string](Get-ObjectValue $Value 'crawled_at')) `
    ([string](Get-ObjectValue $Value 'published_at')) `
    $itemCountValue `
    ([string](Get-ObjectValue $Value 'query')) `
    $limitValue)
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
    $runIdValue = [string](Get-ObjectValue $run 'id')
    if ($runIdValue -eq $CurrentRunId) { continue }
    $runSiteValue = Get-ObjectValue $run 'site'
    $runCountryValue = Get-ObjectValue $run 'country'
    $runItemCountValue = Get-ObjectValue $run 'item_count'
    $runLimitValue = Get-ObjectValue $run 'limit'
    $normalized += [ordered]@{
      id = $runIdValue
      site = if ($runSiteValue) { [string]$runSiteValue } else { 'amazon_jp' }
      country = if ($runCountryValue) { [string]$runCountryValue } else { 'kr' }
      label = [string](Get-ObjectValue $run 'label')
      source = [string](Get-ObjectValue $run 'source')
      crawled_at = [string](Get-ObjectValue $run 'crawled_at')
      published_at = [string](Get-ObjectValue $run 'published_at')
      item_count = if ($null -ne $runItemCountValue) { [int]$runItemCountValue } else { $null }
      csv = [string](Get-ObjectValue $run 'csv')
      jsonl = [string](Get-ObjectValue $run 'jsonl')
      metadata = [string](Get-ObjectValue $run 'metadata')
      query = [string](Get-ObjectValue $run 'query')
      limit = if ($null -ne $runLimitValue) { [int]$runLimitValue } else { 0 }
    }
  }
  return $normalized
}

function ConvertTo-NormalizedObject($Value) {
  if ($null -eq $Value) { return $null }

  if ($Value -is [System.Collections.IDictionary]) {
    $map = [ordered]@{}
    foreach ($key in $Value.Keys) {
      $map[[string]$key] = ConvertTo-NormalizedObject $Value[$key]
    }
    return $map
  }

  if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
    $items = @()
    foreach ($entry in $Value) {
      $items += ,(ConvertTo-NormalizedObject $entry)
    }
    return $items
  }

  if ($Value.PSObject -and $Value.PSObject.Properties.Count -gt 0) {
    $map = [ordered]@{}
    foreach ($prop in $Value.PSObject.Properties) {
      $map[$prop.Name] = ConvertTo-NormalizedObject $prop.Value
    }
    return $map
  }

  return $Value
}

function Read-IndexJson([string]$Path) {
  if (-not (Test-Path $Path)) {
    return @{
      latest = [ordered]@{}
      runs = @()
    }
  }

  $lastError = $null
  foreach ($attempt in 1..5) {
    try {
      $raw = Get-Content $Path -Raw -Encoding UTF8
      if ([string]::IsNullOrWhiteSpace($raw)) {
        throw "index.json is empty"
      }
      return (ConvertTo-NormalizedObject ($raw | ConvertFrom-Json))
    } catch {
      $lastError = $_
      Start-Sleep -Milliseconds (200 * $attempt)
    }
  }

  throw "index.json read/parse failed: $lastError"
}

function Write-IndexJson([string]$Path, $Value) {
  $dir = Split-Path $Path -Parent
  $tmpPath = Join-Path $dir ("index.{0}.tmp" -f [guid]::NewGuid().ToString("N"))
  try {
    $Value | ConvertTo-Json -Depth 10 | Set-Content -Path $tmpPath -Encoding UTF8
    Move-Item -Path $tmpPath -Destination $Path -Force
  } finally {
    if (Test-Path $tmpPath) {
      Remove-Item -Path $tmpPath -Force -ErrorAction SilentlyContinue
    }
  }
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
$env:PUBLISH_INDEX_PATH = $indexPath
$env:PUBLISH_SITE = $Site
$env:PUBLISH_COUNTRY = $Country
$env:PUBLISH_RESULTS_JSONL = $resultsJsonl
$env:PUBLISH_CRAWLED_AT = $crawledAt
$env:PUBLISH_PUBLISHED_AT = $publishedAt
$env:PUBLISH_LINE_COUNT = [string]$lineCount
$env:PUBLISH_QUERY = $Query
$env:PUBLISH_LIMIT = [string]$Limit
$env:PUBLISH_RUN_ID = $runId
$env:PUBLISH_RUN_CSV = ('runs/{0}' -f $runCsvName)
$env:PUBLISH_RUN_JSONL = ('runs/{0}' -f $runJsonlName)
$env:PUBLISH_RUN_LABEL = ("{0} | {1} | {2} | {3} | {4} items" -f $jsonlInfo.LastWriteTime.ToString('yyyy-MM-dd HH:mm'), $Site, $Country, $outName, $lineCount)
$env:PUBLISH_LATEST_CSV = ('sites/{0}/{1}/latest.csv' -f $Site, $Country)
$env:PUBLISH_LATEST_JSONL = ('sites/{0}/{1}/latest.jsonl' -f $Site, $Country)
$env:PUBLISH_METADATA = ('sites/{0}/{1}/metadata.json' -f $Site, $Country)

@'
import json
import os
from pathlib import Path


def new_record(site, country, csv, jsonl, metadata, source, crawled_at, published_at, item_count, query, limit):
    return {
        "site": site,
        "country": country,
        "csv": csv,
        "jsonl": jsonl,
        "metadata": metadata,
        "source": source,
        "crawled_at": crawled_at,
        "published_at": published_at,
        "item_count": item_count,
        "query": query,
        "limit": limit,
    }


def normalize_record(value, fallback_site, fallback_country):
    if not isinstance(value, dict):
        return None
    csv_value = str(value.get("csv", "") or "")
    jsonl_value = str(value.get("jsonl", "") or "")
    if not csv_value or not jsonl_value:
        return None
    return new_record(
        str(value.get("site") or fallback_site),
        str(value.get("country") or fallback_country),
        csv_value,
        jsonl_value,
        str(value.get("metadata") or ""),
        str(value.get("source") or ""),
        str(value.get("crawled_at") or ""),
        str(value.get("published_at") or ""),
        int(value["item_count"]) if value.get("item_count") is not None else None,
        str(value.get("query") or ""),
        int(value["limit"]) if value.get("limit") is not None else 0,
    )


def normalize_latest_map(raw):
    latest = {}
    if not isinstance(raw, dict):
        return latest
    if "csv" in raw and "jsonl" in raw:
        record = normalize_record(raw, "amazon_jp", "kr")
        if record:
            latest["amazon_jp"] = {"kr": record}
        return latest

    for site, record in raw.items():
        if not isinstance(record, dict):
            continue
        if "csv" in record and "jsonl" in record:
            normalized = normalize_record(record, site, "kr")
            if normalized:
                latest[site] = {"kr": normalized}
            continue
        country_map = {}
        for country, country_record in record.items():
            normalized = normalize_record(country_record, site, country)
            if normalized:
                country_map[country] = normalized
        if country_map:
            latest[site] = country_map
    return latest


def normalize_runs(raw, current_run_id):
    runs = []
    if not isinstance(raw, list):
        return runs
    for run in raw:
        if not isinstance(run, dict):
            continue
        if str(run.get("id") or "") == current_run_id:
            continue
        runs.append(
            {
                "id": str(run.get("id") or ""),
                "site": str(run.get("site") or "amazon_jp"),
                "country": str(run.get("country") or "kr"),
                "label": str(run.get("label") or ""),
                "source": str(run.get("source") or ""),
                "crawled_at": str(run.get("crawled_at") or ""),
                "published_at": str(run.get("published_at") or ""),
                "item_count": int(run["item_count"]) if run.get("item_count") is not None else None,
                "csv": str(run.get("csv") or ""),
                "jsonl": str(run.get("jsonl") or ""),
                "metadata": str(run.get("metadata") or ""),
                "query": str(run.get("query") or ""),
                "limit": int(run["limit"]) if run.get("limit") is not None else 0,
            }
        )
    return runs


index_path = Path(os.environ["PUBLISH_INDEX_PATH"])
if index_path.exists():
    existing = json.loads(index_path.read_text(encoding="utf-8-sig"))
else:
    existing = {}

latest = normalize_latest_map(existing.get("latest"))
runs = normalize_runs(existing.get("runs"), os.environ["PUBLISH_RUN_ID"])

site = os.environ["PUBLISH_SITE"]
country = os.environ["PUBLISH_COUNTRY"]
latest.setdefault(site, {})
latest[site][country] = new_record(
    site,
    country,
    os.environ["PUBLISH_LATEST_CSV"],
    os.environ["PUBLISH_LATEST_JSONL"],
    os.environ["PUBLISH_METADATA"],
    os.environ["PUBLISH_RESULTS_JSONL"],
    os.environ["PUBLISH_CRAWLED_AT"],
    os.environ["PUBLISH_PUBLISHED_AT"],
    int(os.environ["PUBLISH_LINE_COUNT"]),
    os.environ.get("PUBLISH_QUERY", ""),
    int(os.environ["PUBLISH_LIMIT"]),
)

new_run = {
    "id": os.environ["PUBLISH_RUN_ID"],
    "site": site,
    "country": country,
    "label": os.environ["PUBLISH_RUN_LABEL"],
    "source": os.environ["PUBLISH_RESULTS_JSONL"],
    "crawled_at": os.environ["PUBLISH_CRAWLED_AT"],
    "published_at": os.environ["PUBLISH_PUBLISHED_AT"],
    "item_count": int(os.environ["PUBLISH_LINE_COUNT"]),
    "csv": os.environ["PUBLISH_RUN_CSV"],
    "jsonl": os.environ["PUBLISH_RUN_JSONL"],
    "metadata": os.environ["PUBLISH_METADATA"],
    "query": os.environ.get("PUBLISH_QUERY", ""),
    "limit": int(os.environ["PUBLISH_LIMIT"]),
}

index_obj = {
    "latest": latest,
    "runs": [new_run] + runs,
}
index_path.write_text(json.dumps(index_obj, ensure_ascii=False, indent=2), encoding="utf-8")
'@ | python -

Write-Host "Copied $results -> $destCsv"
Write-Host "Copied $resultsJsonl -> $destJsonl"
Write-Host "Wrote metadata -> $metaPath"
Write-Host "Saved run -> $runId"
Write-Host "Updated index -> $indexPath"
