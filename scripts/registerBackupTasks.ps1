$ErrorActionPreference = 'Stop'

$serverRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$backupScript = Join-Path $PSScriptRoot 'backupDatabase.js'
$restoreScript = Join-Path $PSScriptRoot 'testBackupRestore.js'
$backupTaskName = 'AssetManager-MongoDB-Backup'
$restoreTaskName = 'AssetManager-MongoDB-Restore-Test'

$action = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument ('"{0}"' -f $backupScript) `
  -WorkingDirectory $serverRoot
$trigger = New-ScheduledTaskTrigger -Daily -At '2:00AM'
$restoreTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '3:00AM'
$principal = New-ScheduledTaskPrincipal `
  -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) `
  -LogonType S4U `
  -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask `
  -TaskName $backupTaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Creates an encrypted local MongoDB backup and removes archives older than the configured retention period.' `
  -Force | Out-Null

$restoreAction = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument ('"{0}"' -f $restoreScript) `
  -WorkingDirectory $serverRoot

Register-ScheduledTask `
  -TaskName $restoreTaskName `
  -Action $restoreAction `
  -Trigger $restoreTrigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Restores the latest encrypted MongoDB archive into a temporary local database, verifies it, then drops it.' `
  -Force | Out-Null

Write-Output "Registered daily backup task '$backupTaskName' at 2:00 AM and weekly restore test '$restoreTaskName' on Sundays at 3:00 AM."
