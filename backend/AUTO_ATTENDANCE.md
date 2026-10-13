# Automatic attendance (office Wi-Fi + PC shutdown)

## How it works

| What happens | Result |
|---|---|
| Staff presses **Sign In** | Signed in at that time. This works exactly as before. |
| Staff forgets, but their phone, the website or their PC connects to the **office Wi-Fi** | Signed in automatically at that moment (`source: "auto"`). |
| Device leaves the office Wi-Fi, or no device checks in for 30 min | Time saved in `lastDisconnectAt`. |
| Device comes back to the office Wi-Fi | `lastDisconnectAt` is cleared. The person is present. |
| Device leaves again | The new disconnect time is saved. |
| Never comes back: gone 60 min **and** (shift over **or** 7h45m already worked) | Signed out at the **last disconnect time** (`autoSignedOut: true`, reason `left_office`). |
| **PC shut down / Windows sign-out** after shift end, or after 7h45m worked | Signed out immediately at the shutdown time (reason `pc_shutdown`). |
| PC shut down or restarted mid-day | Saved only as a disconnect. It is cleared when the PC comes back. |
| Record from a previous day still open | Closed at its last disconnect / last-seen time (reason `day_end`). |
| Staff presses **Sign Out** | Works as before, including the 7h45m rule. |

Other rules:

- "On the office Wi-Fi" is decided by the server, from the request's **public IP** (`OFFICE_ALLOWED_IPS`). A device can't fake it.
- If someone has several devices, they count as present while *any* device is in the office. For example, if the phone leaves but the PC is still on at the desk, that is not a disconnect.
- Someone who signed in by button while working from home is never auto-signed-out. Disconnect tracking only starts once a device has been seen in the office that day.
- Admin / super-admin accounts are never auto-signed in or out. This is the same as the existing auto check-in.

## Step 1 – tell the system which Wi-Fi is the office (REQUIRED)

Without this, nothing is marked automatically.

**Website (admin):** Attendance → Live office presence → **Office Wi-Fi settings** (opens a pop-up).
1. Connect this computer to the office Wi-Fi.
2. Type the Wi-Fi name exactly as phones show it (e.g. `ZAP-Office`) and press **Set this Wi-Fi as office network**.
   That saves the Wi-Fi **name** and the computer's current network address.
3. Add every office Wi-Fi name (2.4 GHz / 5 GHz / other floors). Use **Add name only** when you're not in the office.

**Mobile app (admin):** Home → Office Wi-Fi card → **Save this Wi-Fi as office** (reads the name automatically).

### Why the Wi-Fi NAME and not only the IP
Most office connections have a **dynamic public IP** (e.g. `223.181.62.44` today, `223.181.56.105` tomorrow).
An IP saved once stops matching after the ISP changes it.
- Phones (app) and PCs (Windows agent) send the **Wi-Fi name** with every check-in, and the server matches the name. A changing IP doesn't matter.
- A browser can't read the Wi-Fi name, so the website is matched by network address. When a phone or PC on the office Wi-Fi checks in from a new IP, the server **learns** that IP automatically for 24 h (`OFFICE_LEARNED_IP_HOURS`), so browsers in the office keep working too. Learned addresses show as "learned" in the settings pop-up.
- Optional `.env`: `OFFICE_WIFI_NAMES=ZAP-Office,ZAP-Office-5G`.

The phone must allow **Location** for the app: Android and iOS only share the Wi-Fi name with apps that have it.
Staff whose Location permission is off see a message saying so on the Home screen.

## Backend setup (.env) – optional alternative

```env
# Same as the button above, set by hand: your office's PUBLIC IP / ranges.
OFFICE_ALLOWED_IPS=203.0.113.5
# Backend running inside the office LAN? Treat every 192.168/10/172.16 device as in-office:
# OFFICE_ALLOW_PRIVATE_LAN=true
# URL the PC agent should call (your public backend URL)
PUBLIC_API_URL=https://hrm-api.example.com

# Optional tuning (defaults shown)
PRESENCE_OFFLINE_TIMEOUT_MINUTES=30   # no check-in for this long = disconnected
AUTO_SIGNOUT_GRACE_MINUTES=60         # gone this long before auto sign-out
PRESENCE_SWEEP_INTERVAL_MINUTES=5
# PRESENCE_SWEEP_DISABLED=true        # on extra server instances
```

If the office has a static IP, use it. If the ISP changes it, ask them for a static IP or use the CIDR range they give you (e.g. `203.0.113.0/29`).

## New API (mounted at `/api/presence`)

| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | `/heartbeat` | logged-in user **or** PC agent (`X-Device-Token`) | `{ event, deviceId, platform, name }`. Events: `startup, heartbeat, online, resume, login, offline, shutdown, sleep, logoff` |
| GET | `/me` | user | My status today, presence events and devices |
| GET | `/agent/windows?name=` | user | Downloads a personal Windows installer (creates a device key) |
| DELETE | `/devices/:id` | owner / admin | Remove a device (revokes the PC key) |
| GET | `/live` | admin | Everyone's presence today |
| GET / POST / DELETE | `/office-networks` | admin | List / save current Wi-Fi as office / remove |

The old `POST /api/hrm/leaves/attendance/auto-checkin` still works and now records presence too.

New fields on `Attendance`: `lastSeenInOfficeAt`, `lastDisconnectAt`, `autoSignedOut`, `signOutReason`, `presenceEvents[]`. Source `"auto"` was added.
New collection: `presencedevices`.

## Windows PC agent

Website → Dashboard → Attendance card → **Set up** → **Download**. Then run the file on the staff member's own PC:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install-HrmAttendanceAgent.ps1
```

- Run it from an **Administrator** PowerShell, logged in as the staff member, so shutdown detection gets registered.
- The agent checks in every 5 minutes, and immediately when the network changes.
- It reports shutdown/restart (event 1074), Windows sign-out (7002), sleep (42) and wake.
- Hard power cuts can't be reported. In that case the person is signed out at the last time the PC was seen.
- Uninstall: same command with `-Uninstall`.
- Log file: `%LOCALAPPDATA%\HrmPresence\agent.log`.

## Mobile app

Install the new packages, then make a new build. Background tasks don't run in Expo Go.

```bash
npx expo install expo-network expo-task-manager expo-background-task
npx expo prebuild   # or: eas build
```

- The app checks in when it opens or returns to the foreground, whenever the network changes (joined or left Wi-Fi), and every 5 minutes while it's open.
- In the background, the phone OS lets it check in roughly every 15 minutes on Android, and less predictably on iOS. That is why the PC agent is the most accurate source for sign-out times.

## Notes
- Office Wi-Fi comes from the admin screen list plus `OFFICE_ALLOWED_IPS` in `.env`.
- Admins are marked automatically too; set `AUTO_ATTENDANCE_INCLUDE_ADMINS=false` for staff only.
  The super admin is never marked.
- Set `TRUST_PROXY_HOPS` to the real number of proxies in front of the server.
- The browser only reports while the site is open; for marking in the background use the
  mobile app or the Windows PC agent.
- Many phones use IPv6: add that range (e.g. `2401:4900:88b1:ac1e::/64`) with the "add by hand" box.
