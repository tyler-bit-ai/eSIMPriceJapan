param(
  [string]$Query = '',
  [int]$Limit = 200,
  [int]$Concurrency = 2,
  [int]$MinDelay = 1,
  [int]$MaxDelay = 2,
  [string]$OutDir = '.\out_partial_qoo10_jp_th',
  [string]$RepoRoot = '',
  [string]$DataDir = 'dashboard\data',
  [switch]$PublishOnly
)

$ErrorActionPreference = 'Stop'

function Resolve-AbsPath([string]$base, [string]$path) {
  if ([System.IO.Path]::IsPathRooted($path)) {
    return (Resolve-Path $path).Path
  }
  return (Resolve-Path (Join-Path $base $path)).Path
}

$effectiveRepoRoot = if ([string]::IsNullOrWhiteSpace($RepoRoot)) { Join-Path $PSScriptRoot '..' } else { $RepoRoot }
$repo = Resolve-Path $effectiveRepoRoot
Set-Location $repo

if (-not (Test-Path '.git')) {
  throw "현재 경로는 git 저장소가 아닙니다: $repo"
}

$site = 'qoo10_jp'
$country = 'th'

$pythonCandidates = @(
  (Join-Path $repo '.venv\Scripts\python.exe'),
  'C:\Codex\eSIMPriceCollector_Japan\.venv\Scripts\python.exe',
  'python'
)
$python = $null
foreach ($cand in $pythonCandidates) {
  if ($cand -eq 'python') {
    $python = $cand
    break
  }
  if (Test-Path $cand) {
    $python = $cand
    break
  }
}
if (-not $python) {
  throw "python 실행 파일을 찾을 수 없습니다."
}

$outPath = if ([System.IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $repo $OutDir }
$dataPath = if ([System.IO.Path]::IsPathRooted($DataDir)) { $DataDir } else { Join-Path $repo $DataDir }

if (-not $PublishOnly) {
  Write-Host "[1/2] Partial crawl start ($site, $country)"
  if ([string]::IsNullOrWhiteSpace($Query)) {
    & $python -m app crawl --site $site --country $country --limit $Limit --concurrency $Concurrency --min-delay $MinDelay --max-delay $MaxDelay --out $outPath
  } else {
    & $python -m app crawl --site $site --country $country --query $Query --limit $Limit --concurrency $Concurrency --min-delay $MinDelay --max-delay $MaxDelay --out $outPath
  }
  if ($LASTEXITCODE -ne 0) {
    throw "partial crawl 실패 (exit=$LASTEXITCODE)"
  }
}

Write-Host "[2/2] Publish qoo10_jp/th latest only"
$publishScript = Join-Path $repo 'tools\publish.ps1'
$publishArgs = @(
  '-ExecutionPolicy', 'Bypass',
  '-File', $publishScript,
  '-OutDir', $outPath,
  '-DataDir', $dataPath,
  '-Site', $site,
  '-Country', $country,
  '-Limit', $Limit
)
if (-not [string]::IsNullOrWhiteSpace($Query)) {
  $publishArgs += @('-Query', $Query)
}
& powershell @publishArgs
if ($LASTEXITCODE -ne 0) {
  throw "publish.ps1 실패 (exit=$LASTEXITCODE)"
}

Write-Host "완료: qoo10_jp/th partial refresh published"
