# ─────────────────────────────────────────────────────────────────────────
#  HRM automatic attendance — PC agent installer (Windows 10 / 11)
#  Generated for: __USER_NAME__ (__USER_EMAIL__)
#
#  HOW TO INSTALL
#    Right-click this file -> "Run with PowerShell".
#    (For shutdown detection, run it from an *Administrator* PowerShell:
#       powershell -ExecutionPolicy Bypass -File .\__FILE_NAME__ )
#
#  WHAT IT DOES
#    - Signs you in automatically when this PC is on the office network.
#    - Stores the time you leave the office network.
#    - Signs you out when you shut the PC down after your shift.
#
#  UNINSTALL
#    powershell -ExecutionPolicy Bypass -File .\__FILE_NAME__ -Uninstall
#
#  This file contains a personal device key. Do not share it.
# ─────────────────────────────────────────────────────────────────────────
param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$installDir = Join-Path $env:LOCALAPPDATA "HrmPresence"
$agentPath = Join-Path $installDir "HrmPresenceAgent.ps1"
$startupCmd = Join-Path ([Environment]::GetFolderPath("Startup")) "HrmPresenceAgent.cmd"
$taskNames = @("HRM Presence - Logon", "HRM Presence - Shutdown", "HRM Presence - Logoff", "HRM Presence - Sleep", "HRM Presence - Resume")
$psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

function Remove-Agent {
    foreach ($t in $taskNames) {
        try { Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue } catch {}
    }
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*HrmPresenceAgent.ps1*-Loop*" } |
        ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }
    if (Test-Path $startupCmd) { Remove-Item $startupCmd -Force }
    if (Test-Path $installDir) { Remove-Item $installDir -Recurse -Force }
}

if ($Uninstall) {
    Remove-Agent
    Write-Host "HRM presence agent removed." -ForegroundColor Green
    exit 0
}

Write-Host "Installing HRM presence agent for __USER_NAME__ ..." -ForegroundColor Cyan
Remove-Agent
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

# ── Agent script ──────────────────────────────────────────────────────────
$agent = @'
__AGENT_SCRIPT__
'@
Set-Content -Path $agentPath -Value $agent -Encoding UTF8

@{
    apiUrl     = "__API_URL__"
    token      = "__DEVICE_TOKEN__"
    deviceName = "__DEVICE_NAME__"
} | ConvertTo-Json | Set-Content -Path (Join-Path $installDir "config.json") -Encoding UTF8

# Only this Windows user may read the device key.
try {
    icacls $installDir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
} catch {}

$userId = "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

function New-AgentAction([string]$argsTail) {
    New-ScheduledTaskAction -Execute $psExe `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$agentPath`" $argsTail"
}

function New-EventTrigger([string]$log, [string]$xpath) {
    $class = Get-CimClass -ClassName MSFT_TaskEventTrigger -Namespace Root/Microsoft/Windows/TaskScheduler
    $trigger = $class | New-CimInstance -ClientOnly
    $trigger.Enabled = $true
    $trigger.Subscription = "<QueryList><Query Id=`"0`" Path=`"$log`"><Select Path=`"$log`">$xpath</Select></Query></QueryList>"
    return $trigger
}

# ── 1. Start the agent at every logon ─────────────────────────────────────
$logonOk = $false
try {
    Register-ScheduledTask -TaskName "HRM Presence - Logon" -Action (New-AgentAction "-Loop") `
        -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $userId) `
        -Settings $settings -Principal $principal -Force | Out-Null
    $logonOk = $true
} catch {
    # Not allowed without admin rights -> use the Startup folder instead.
    "@echo off`r`nstart `"`" /min `"$psExe`" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$agentPath`" -Loop" |
        Set-Content -Path $startupCmd -Encoding ASCII
    $logonOk = $true
}

# ── 2. Shutdown / logoff / sleep / resume detection ───────────────────────
$eventTasks = @(
    @{ Name = "HRM Presence - Shutdown"; Log = "System"; Evt = "shutdown";
       XPath = "*[System[Provider[@Name='User32'] and EventID=1074]]" },
    @{ Name = "HRM Presence - Logoff"; Log = "System"; Evt = "logoff";
       XPath = "*[System[Provider[@Name='Microsoft-Windows-Winlogon'] and EventID=7002]]" },
    @{ Name = "HRM Presence - Sleep"; Log = "System"; Evt = "sleep";
       XPath = "*[System[Provider[@Name='Microsoft-Windows-Kernel-Power'] and EventID=42]]" },
    @{ Name = "HRM Presence - Resume"; Log = "System"; Evt = "resume";
       XPath = "*[System[Provider[@Name='Microsoft-Windows-Power-Troubleshooter'] and EventID=1]]" }
)
$eventOk = 0
foreach ($t in $eventTasks) {
    try {
        Register-ScheduledTask -TaskName $t.Name -Action (New-AgentAction "-Event $($t.Evt)") `
            -Trigger (New-EventTrigger $t.Log $t.XPath) -Settings $settings -Principal $principal -Force | Out-Null
        $eventOk++
    } catch {
        Write-Host "  Could not register '$($t.Name)': $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# ── 3. Start now and send a first check-in ────────────────────────────────
Start-Process -FilePath $psExe -WindowStyle Hidden `
    -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$agentPath`" -Loop"

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Auto sign-in on office network : ON"
if ($eventOk -ge 1) {
    Write-Host "  Shutdown / logoff detection    : ON"
} else {
    Write-Host "  Shutdown / logoff detection    : OFF - re-run this file from an Administrator PowerShell to enable it." -ForegroundColor Yellow
    Write-Host "  (Without it, you are still signed out at the last time this PC was seen on the office network.)"
}
Write-Host "  Log file: $installDir\agent.log"
Start-Sleep -Seconds 3
