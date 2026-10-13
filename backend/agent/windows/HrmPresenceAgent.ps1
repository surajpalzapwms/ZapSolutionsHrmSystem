# HRM Presence Agent (Windows)
#
# Tells the HRM backend whether this PC is on the office network, so
# attendance is signed in / out automatically:
#   -Loop             runs at Windows logon: sends "startup", then a heartbeat
#                     every 5 minutes and immediately whenever the network
#                     changes (e.g. joined / left the office Wi-Fi).
#   -Event shutdown   sent by a scheduled task when Windows starts shutting
#                     down or restarting (System log, User32 event 1074).
#   -Event logoff     user signs out of Windows (Winlogon event 7002).
#   -Event sleep      PC goes to sleep (Kernel-Power event 42).
#   -Event resume     PC wakes up (Power-Troubleshooter event 1).
#
# Config lives next to this file in config.json (apiUrl, token, deviceName).
# The token only allows sending presence for its owner — it cannot read any
# HR data. Revoke it from the website (Dashboard > This PC) at any time.

param(
    [string]$Event = "heartbeat",
    [switch]$Loop
)

$ErrorActionPreference = "SilentlyContinue"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg = Get-Content -Raw -Path (Join-Path $here "config.json") | ConvertFrom-Json
$logFile = Join-Path $here "agent.log"

function Write-Log([string]$msg) {
    try {
        $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
        Add-Content -Path $logFile -Value $line
        # keep the log small
        if ((Get-Item $logFile).Length -gt 512KB) {
            Get-Content $logFile -Tail 500 | Set-Content $logFile
        }
    } catch {}
}

# Name (SSID) and router address (BSSID) of the Wi-Fi this PC is on.
# The server matches the office by Wi-Fi NAME, so a changing office IP
# doesn't matter. Empty on a cable connection (then the IP is used).
function Get-WifiInfo {
    $info = @{ ssid = ""; bssid = "" }
    try {
        $out = netsh wlan show interfaces 2>$null
        foreach ($line in $out) {
            if ($line -match '^\s*SSID\s*:\s*(.+)$' -and -not $info.ssid) { $info.ssid = $Matches[1].Trim() }
            elseif ($line -match '^\s*(BSSID|AP BSSID)\s*:\s*(.+)$' -and -not $info.bssid) { $info.bssid = $Matches[2].Trim() }
            elseif ($line -match '^\s*State\s*:\s*disconnected') { return @{ ssid = ""; bssid = "" } }
        }
    } catch {}
    return $info
}

function Send-Presence([string]$evt, [int]$timeoutSec = 10) {
    $wifi = Get-WifiInfo
    $body = @{
        event    = $evt
        platform = "pc"
        name     = $cfg.deviceName
        hostname = $env:COMPUTERNAME
        user     = $env:USERNAME
        wifi     = $wifi
    } | ConvertTo-Json -Compress
    try {
        $res = Invoke-RestMethod -Method Post `
            -Uri ($cfg.apiUrl.TrimEnd("/") + "/api/presence/heartbeat") `
            -Headers @{ "X-Device-Token" = $cfg.token } `
            -ContentType "application/json" -Body $body -TimeoutSec $timeoutSec
        Write-Log ("{0} -> wifi='{1}' inOffice={2} via={3} action={4}" -f $evt, $wifi.ssid, $res.inOffice, $res.via, $res.action)
        return $true
    } catch {
        Write-Log ("{0} -> failed: {1}" -f $evt, $_.Exception.Message)
        return $false
    }
}

function Get-NetworkSignature {
    try {
        $p = Get-NetConnectionProfile | Sort-Object InterfaceIndex |
            ForEach-Object { "$($_.Name)|$($_.InterfaceAlias)|$($_.IPv4Connectivity)" }
        # Include the Wi-Fi name so switching Wi-Fi networks is noticed too.
        return (($p -join ";") + "|" + (Get-WifiInfo).ssid)
    } catch { return "" }
}

if (-not $Loop) {
    # One-shot event (shutdown / logoff / sleep / resume). Keep it fast:
    # Windows gives shutdown tasks only a few seconds.
    $t = 10
    if ($Event -in @("shutdown", "logoff", "sleep")) { $t = 5 }
    [void](Send-Presence $Event $t)
    exit 0
}

# ── Loop mode: only one copy per user session ──────────────────────────────
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Local\HrmPresenceAgent", [ref]$created)
if (-not $created) { exit 0 }

Write-Log "agent started"
[void](Send-Presence "startup")

$heartbeatEvery = 300   # seconds
$checkEvery = 30        # seconds between network-change checks
$lastSent = Get-Date
$lastSig = Get-NetworkSignature

while ($true) {
    Start-Sleep -Seconds $checkEvery
    $sig = Get-NetworkSignature
    $due = ((Get-Date) - $lastSent).TotalSeconds -ge $heartbeatEvery
    if ($sig -ne $lastSig) {
        Write-Log "network changed: '$lastSig' -> '$sig'"
        $lastSig = $sig
        # give DHCP/DNS a moment after joining a network
        Start-Sleep -Seconds 5
        if ([string]::IsNullOrEmpty($sig)) { [void](Send-Presence "offline") }
        else { [void](Send-Presence "online") }
        $lastSent = Get-Date
    } elseif ($due) {
        [void](Send-Presence "heartbeat")
        $lastSent = Get-Date
    }
}
