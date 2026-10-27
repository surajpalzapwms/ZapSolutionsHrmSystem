# Staff profile photos on the website (14 Oct 2026)

- New `components/common/StaffAvatar.jsx`: round photo with initials as fallback.
- Photo (uploaded from the app or the website) now shows in the **Staff tab table**, the **Staff
  Details** header and the **Attendance staff list**. Before, only the profile menu, birthday card
  and the documents section drew photos, so a photo uploaded in the app never appeared in the lists.
- Uploading / removing a photo in Staff Details refreshes the table and the header immediately.
- Needs the matching backend change (`photoUrl` on `/api/staff` and on the leave staff summary).

# Letters, resignation date & birthday wishes (13 Oct 2026)

## HR letters (backend + website + app)
- All six letters (Offer, Joining, Confirmation, Termination, Leaving, Experience) now open the
  "Generate letter" details form and are made by the server — the app shows/downloads exactly
  the same PDF as the website.
- Termination letter: an admin / super admin can pick ANY staff member and generate it. The
  form asks for the last working day (any date: past, today or future) and an optional reason.
  Once generated, it unlocks in that staff member's app.
- Leaving / Experience letters: the last working day comes from the staff member's resignation
  (approved, else pending). With no resignation, HR picks any date — today or a future date for
  someone still working. Approving a resignation later moves an already generated letter to the
  approved date. Wording switches to future tense ("will be relieved on …") for a future date.
- Letter date for these three = the last working day once it has come; today while it is still
  in the future.
- Mobile app: letter tiles are never locked for admin / super admin — they open the Generate
  Letters screen (pick staff, generate, view, download, withdraw). Staff tiles stay locked until
  HR generates the letter.

## Birthday wishes (app + website)
- On the birthday itself, from 12:00 midnight India time, every colleague gets a "🎉 Wish"
  button (Home "Birthday today" card + Upcoming Birthdays list in the app; dashboard card on the
  website). It opens a party modal (balloons, cake, confetti, gifts) with ready-made wishes and
  a box to write any message (300 chars).
- The birthday person sees how many colleagues wished them and can read every message.
- Card reloads itself at midnight. DOB is read in India time so the day is never off by one.

## Speed
- Letter status no longer queries resignations; admin app skips the "my letters" call.
- App letters screen loads the staff member's letters and history once (switching type is instant).
- Birthday photos: full staff list fetched at most every 5 min instead of on every Home focus.

## Fix
- frontend: `Leavehistorymodal.jsx` renamed to `LeaveHistoryModal.jsx` (the imports use that
  name; the build failed on Linux/Vercel).

# HRM – cleanup & performance changes

## Why it was slow
- The header clock re-rendered the whole layout (both sidebars + header) every second.
- The holiday ticker forced a browser layout calculation 60 times a second on every page.
- Excel (xlsx, exceljs ~1.4 MB) and PDF (jspdf ~400 KB) libraries loaded as soon as a page opened.
- The dashboard downloaded every attendance/leave record ever saved on each visit.
- The backend staff summary ran ~5 database queries per staff member.
- The staff calendar polled the server every 60 s for data nothing displayed.

## Frontend
- Clock isolated in its own component; holiday ticker is now a pure-CSS animation.
- Excel/PDF libraries load only when an import dialog is opened or a file is downloaded.
- Page loading spinner appears only in the content area (sidebar/header stay visible).
- React/router/axios split into long-cached vendor chunks (vite.config.js).
- Dashboard: admins load only this year's attendance/leaves; full history loads only for "All" or an earlier custom range. Staff no longer call admin-only endpoints.
- Removed the duplicate mobile sidebar each page drew on top of the layout's own sidebar.
- Bug fixes:
  - Delete leave called a non-existent URL.
  - Multi-day leave requests now group by `batchId` and approve/reject in one click (per-day balance checks still apply).
  - Bulk delete for Payroll and Holidays (no backend bulk route) now deletes one by one.
  - Staff dashboard Pending Payroll / Advance / Total Leave always showed 0; card links pointed to admin-only pages.
- Removed: 19 unused components/hooks/contexts, unreachable Payroll edit modal, dead polling, unused service calls, non-working PWA pieces (InstallPWA, sw.js, manifest, offline page, icon script), unused assets, `recharts` and `vite-plugin-node-polyfills`.
- `calendarGridPieces.jsx` split: constants/helpers moved to `calendarHelpers.js`.
- ESLint now passes with no errors or warnings.

## Backend
- `GET /api/hrm/leaves/attendance` and `GET /api/hrm/leaves` accept optional `?from=YYYY-MM-DD&to=YYYY-MM-DD`.
- Staff summary: 3 count queries per staff replaced by one aggregation; remaining per-staff work runs in parallel.
- `.lean()` on leave/holiday lists; holiday sort fixed (was sorting on a non-existent field).
- New index `Attendance { loginTime: -1 }`; duplicate ExpenseCategory index removed.
- Request logging (morgan) disabled when NODE_ENV=production.
- Removed 14 unused files, 3 dead functions, `excel4node` and `json2csv`.

## After deploying
- Run `npm install` in both folders (package.json changed).
- MongoDB builds the new attendance index automatically on startup.

## Still recommended (not changed)
- Any logged-in staff account can fetch every staff member's staff list, payroll and advances (`GET /api/staff`, `/api/hrm/payroll`, `/api/hrm/advances`). Consider restricting these to admins or to the caller's own records.

## Multi-company / white label removed (Oct 2026)
- Removed the Companies page (`/companies`), Company Branding page, company switcher in the
  sidebar, `X-Company-Id` header and per-company tabs. Everyone logs straight into the dashboard.
- Branding is fixed in `src/utils/brand.js` (logo `public/mainlogo.png`). Optional build-time
  overrides: `VITE_COMPANY_NAME`, `VITE_COMPANY_LOGO_URL`, `VITE_COMPANY_PRIMARY_COLOR`,
  `VITE_COMPANY_SIDEBAR_COLOR`, `VITE_COMPANY_FINANCE_TITLE`, `VITE_COMPANY_LOGIN_TITLE`, ...

## Staff documents + payslip name (Oct 2026)
- Staff details modal: "Photo & Documents" section — view / upload / replace / remove the profile
  photo, Aadhaar card, PAN card and light bill (same files staff upload from the app).
- Payslip PDF file name: `<Staff_Name>_<Month>_<Year>.pdf`.
- Renamed `Leavehistorymodal.jsx` -> `LeaveHistoryModal.jsx` (the imports used that spelling, so the
  build failed on Linux / Vercel).

## Update — 12 Oct 2026

- Month summary: under "29/30 days paid" the reason is shown when a month has fewer paid days
  (joining date, relieving date, or month not finished yet).

## Update — 12 Oct 2026 (letters)

- Staff → Letters → Generate (Offer / Joining / Confirmation) opens a details form asking only for what is
  missing; "Edit details" on a generated letter changes the details and generates it again.
