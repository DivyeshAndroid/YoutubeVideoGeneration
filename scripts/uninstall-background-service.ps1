$ErrorActionPreference = "Stop"
$TaskName = "YoutubeVideoGeneration"
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed Windows scheduled task '$TaskName'."
} else {
  Write-Host "Windows scheduled task '$TaskName' is not installed."
}
