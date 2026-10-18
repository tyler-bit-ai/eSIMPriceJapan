param(
  [string]$OutDir = '.\data\crawls\out',
  [string]$DataDir = 'dashboard\data',
  [string]$Site = 'amazon_jp',
  [string]$Country = 'kr',
  [string]$Query = '',
  [int]$Limit = 0
)

# Thin wrapper kept for the Windows manual flow; the logic lives in tools/publish.py.
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
$python = Join-Path $repo '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { $python = 'python' }

Push-Location $repo
try {
  $publishArgs = @('-m', 'tools.publish', '--out-dir', $OutDir, '--data-dir', $DataDir, '--site', $Site, '--country', $Country, '--limit', $Limit)
  # Windows PowerShell drops empty native arguments, so only pass --query when set.
  if (-not [string]::IsNullOrWhiteSpace($Query)) { $publishArgs += @('--query', $Query) }
  & $python @publishArgs
  if ($LASTEXITCODE -ne 0) { throw "publish failed (exit=$LASTEXITCODE)" }
} finally {
  Pop-Location
}
