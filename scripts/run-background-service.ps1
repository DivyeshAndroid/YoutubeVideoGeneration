$ErrorActionPreference = "Stop"
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $ProjectDir
$Node = (Get-Command node.exe).Source
& $Node scripts/scheduler-runner.mjs
exit $LASTEXITCODE
