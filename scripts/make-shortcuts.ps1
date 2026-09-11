# Creates "Lancible" shortcuts on the Desktop and in the Start Menu,
# pointing at the packaged exe. Run after `npm run package`:
#   npm run shortcuts
# ASCII-only on purpose: Windows PowerShell 5.1 mis-decodes non-BOM UTF-8 scripts.
$ErrorActionPreference = 'Stop'

$exe = Join-Path $PSScriptRoot '..\dist\Lancible-win32-x64\Lancible.exe'
$exe = [System.IO.Path]::GetFullPath($exe)
if (-not (Test-Path $exe)) {
  Write-Error "Not found: $exe - run `npm run package` first"
  exit 1
}

$appDir = Split-Path $exe
$ws = New-Object -ComObject WScript.Shell
$dirs = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
)

foreach ($dir in $dirs) {
  # remove the old "Task Timer" shortcut if present
  $old = Join-Path $dir 'Task Timer.lnk'
  if (Test-Path $old) { Remove-Item $old -Force; Write-Host "removed old: $old" }

  $lnk = Join-Path $dir 'Lancible.lnk'
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = $exe
  $s.WorkingDirectory = $appDir
  $s.IconLocation = "$exe,0"
  $s.Description = 'Lancible'
  $s.Save()
  Write-Host "shortcut: $lnk"
}
