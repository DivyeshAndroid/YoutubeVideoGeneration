$ErrorActionPreference = "Stop"
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Npm = (Get-Command npm.cmd).Source
$TaskName = "YoutubeVideoGeneration"
$Action = New-ScheduledTaskAction -Execute $Npm -Argument "run scheduler" -WorkingDirectory $ProjectDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description "Runs the YouTube Shorts scheduler in the background" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Installed and started Windows scheduled task '$TaskName'."
