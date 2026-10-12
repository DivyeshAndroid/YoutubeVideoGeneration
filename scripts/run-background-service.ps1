$ErrorActionPreference = "Stop"
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $ProjectDir
$LogDir = Join-Path $ProjectDir "work\logs"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$LogFile = Join-Path $LogDir "scheduler.log"
$Npm = (Get-Command npm.cmd).Source
& $Npm run scheduler *>> $LogFile
exit $LASTEXITCODE
