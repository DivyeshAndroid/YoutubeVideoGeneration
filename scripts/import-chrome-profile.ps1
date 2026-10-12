param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9 _-]+$')][string]$ProfileDirectory,
  [string]$SourceRoot = (Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"),
  [string]$DestinationRoot = "",
  [switch]$FullProfile
)
$ErrorActionPreference = "Stop"
if (!$DestinationRoot) { $DestinationRoot = Join-Path $PSScriptRoot "..\work\leonardo-divyesh" }
$SourceRoot = (Resolve-Path -LiteralPath $SourceRoot).Path
$DestinationRoot = [IO.Path]::GetFullPath($DestinationRoot)
if (Test-Path -LiteralPath $DestinationRoot) { throw "Destination already exists; choose an empty automation directory." }
$sourceBrowsers = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object {
  $_.CommandLine -and $_.CommandLine -notmatch '--type=' -and
  ($_.CommandLine -notmatch '--user-data-dir=' -or $_.CommandLine.Contains($SourceRoot))
}
if ($sourceBrowsers) { throw "Close Chrome windows using the source profile before importing its saved session." }
$sourceProfile = Join-Path $SourceRoot $ProfileDirectory
if (!(Test-Path -LiteralPath $sourceProfile)) { throw "Chrome profile directory not found: $ProfileDirectory" }
$sourceState = Get-Content -LiteralPath (Join-Path $SourceRoot "Local State") -Raw | ConvertFrom-Json
$selectedProfile = $sourceState.profile.info_cache.PSObject.Properties[$ProfileDirectory].Value
if (!$selectedProfile) { throw "Profile is not listed in Chrome's Local State." }
$destinationProfile = Join-Path $DestinationRoot $ProfileDirectory
New-Item -ItemType Directory -Path $destinationProfile -Force | Out-Null
$state = @{ os_crypt = $sourceState.os_crypt; profile = @{ info_cache = @{ $ProfileDirectory = $selectedProfile }; last_used = $ProfileDirectory; last_active_profiles = @($ProfileDirectory) } }
$stateJson = $state | ConvertTo-Json -Depth 100
[IO.File]::WriteAllText((Join-Path $DestinationRoot "Local State"), $stateJson, (New-Object Text.UTF8Encoding($false)))
if ($FullProfile) {
  Copy-Item -LiteralPath $sourceProfile -Destination $DestinationRoot -Recurse -Force
  Write-Output "Copied full Chrome profile '$($selectedProfile.name)' ($ProfileDirectory) into $DestinationRoot."
  return
}
foreach ($entry in @("Preferences", "Secure Preferences", "Local Storage", "Session Storage", "IndexedDB", "WebStorage")) {
  $sourceEntry = Join-Path $sourceProfile $entry
  if (Test-Path -LiteralPath $sourceEntry) { Copy-Item -LiteralPath $sourceEntry -Destination $destinationProfile -Recurse }
}
$destinationNetwork = Join-Path $destinationProfile "Network"
New-Item -ItemType Directory -Path $destinationNetwork -Force | Out-Null
foreach ($cookieFile in @("Cookies", "Cookies-journal", "Cookies-wal", "Cookies-shm")) {
  $sourceCookieFile = Join-Path $sourceProfile "Network\$cookieFile"
  if (Test-Path -LiteralPath $sourceCookieFile) { Copy-Item -LiteralPath $sourceCookieFile -Destination $destinationNetwork }
}
Write-Output "Imported Chrome profile '$($selectedProfile.name)' ($ProfileDirectory) into $DestinationRoot."
