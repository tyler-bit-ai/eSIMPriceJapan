param(
  [string]$Site = 'amazon_jp',
  [string]$Query = 'eSIM 韓国',
  [int]$Limit = 200,
  [int]$Concurrency = 2,
  [int]$MinDelay = 1,
  [int]$MaxDelay = 2,
  [string]$OutDir = '.\out_auto',
  [string]$RepoRoot = '',
  [string]$DataDir = 'dashboard\data',
  [switch]$SkipPush
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

Write-Host "[1/3] Crawl start"
& $python -m app crawl --site $Site --query $Query --limit $Limit --concurrency $Concurrency --min-delay $MinDelay --max-delay $MaxDelay --out $outPath
if ($LASTEXITCODE -ne 0) {
  throw "crawl 실패 (exit=$LASTEXITCODE)"
}

Write-Host "[2/3] Publish static dashboard data"
$publishScript = Join-Path $repo 'tools\publish.ps1'
& powershell -ExecutionPolicy Bypass -File $publishScript -OutDir $outPath -DataDir $dataPath
if ($LASTEXITCODE -ne 0) {
  throw "publish.ps1 실패 (exit=$LASTEXITCODE)"
}

Write-Host "[3/3] Git commit/push"
git add dashboard/data/latest.csv dashboard/data/latest.jsonl dashboard/data/metadata.json dashboard/data/index.json dashboard/data/runs tools/publish.ps1 tools/run_and_publish.ps1 README.md

$hasChanges = (git status --porcelain).Length -gt 0
if (-not $hasChanges) {
  Write-Host "변경 사항이 없어 commit/push를 건너뜁니다."
  exit 0
}

$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$msg = "chore(data): update crawl dataset ($Site, limit=$Limit, $ts)"
git commit -m $msg
if ($LASTEXITCODE -ne 0) {
  throw "git commit 실패 (exit=$LASTEXITCODE)"
}

if ($SkipPush) {
  Write-Host "SkipPush 지정됨: push는 생략했습니다."
  exit 0
}

git push origin main
if ($LASTEXITCODE -ne 0) {
  throw "git push 실패 (exit=$LASTEXITCODE)"
}

Write-Host "완료: crawl + publish + push"
