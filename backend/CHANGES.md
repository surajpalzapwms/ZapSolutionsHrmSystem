# Disabled staff, Enable/Disable from the app, staff photos (14 Oct 2026)

## Disabled staff no longer show anywhere except the Staff tab
- `/api/hrm/attendance` (`/`, `/today`, `/yesterday`) now drops disabled staff too. The mobile app's
  "today" list used this path and it was the one list the filter did not cover.
- `?includeHidden=true` (used only by the Staff tab) is honoured for admin / super admin only.
  A plain staff login asking for it gets the normal filtered list.
- A disabled account that still has the app open gets `403 STAFF_INACTIVE` on its next request
  (already the case); the app now signs out on it (see Mobile/CHANGES.md).

## Photos uploaded in the app now show on the website
- `GET /api/staff`, `GET /api/staff/:id` and `GET /api/staff/me` return `photoUrl` for every staff
  member using the same lookup as the birthday list: a photo that exists but whose record has no
  `photoUpdatedAt` is repaired, a photo saved on another record with the same e-mail is found, and a
  photo saved on the login account before the staff record existed is used.
- `GET /api/hrm/leaves/staff-summary` rows (Attendance tab list) now include `photoUrl`.
- Any write to `/api/documents` (upload / remove photo) clears the cached summaries so the new photo
  appears straight away.

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

## Attendance / leave fixes (Sep 2026)
- Automatic absence marking now always saves **Unpaid** leave. It used to spend Sick → Casual → Paid first, so absences showed up as paid leave nobody applied for (even before the confirmation date).
- Non-holiday Saturdays are now checked for absence too (every Saturday used to be skipped).
- Half Day / Absent marks are saved at 10:00 IST instead of 00:00 IST. 00:00 IST is the previous day in UTC, which made a Half Day on 6 Aug show on 5 Aug. The calendar now places attendance by its own date, so old records show on the right day as well.
- Paid / Sick / Casual can't be set on a date before the confirmation date (Edit Day, Excel leave import). Import rows for those days are saved as Unpaid.
- Confirmation-date checks compare India calendar days (a date stored as 19 Aug 18:30 UTC is 20 Aug).
- New one-off script `scripts/fixAutoLeavesAndHalfDays.js` repairs data saved by the old code (preview by default, `--apply` to save).

## Automatic attendance from office Wi-Fi + PC shutdown (Oct 2026)
See AUTO_ATTENDANCE.md. New: `/api/presence` routes, `PresenceDevice` model, presence fields on Attendance, 5-minute presence sweep in server.js, Windows PC agent (`agent/windows`). Sign-out math moved into `finalizeSignOut()` (controllers/leave.js), shared by the Sign Out button and automatic sign-out. Set `OFFICE_ALLOWED_IPS` and `PUBLIC_API_URL` in .env.

## Multi-company + Wi-Fi attendance fixes (Oct 2026)
(Removed again later — see below.) One database for many companies; every record has a `company`
and queries are filtered automatically. Super admin: Companies list -> open one.
- Old data migrates into company #1 on first start (back up first).
- Office Wi-Fi lists, branding, leave policy, caches, daily jobs are per company.
- Attendance: admins are auto-marked (AUTO_ATTENDANCE_INCLUDE_ADMINS), super admin never;
  `TRUST_PROXY_HOPS` replaces the hardcoded proxy count; office-networks response now
  shows `forwardedFor` / `trustProxyHops` to debug a wrong IP.
- Security: db.js no longer prints the MongoDB URI (password) to the logs; removed
  models/auth.js (junk file containing a server login); login no longer logs requests.

## Multi-company / white label removed (Oct 2026)
The app is single-company again.
- Removed: `/api/company` routes (company list, add/edit/delete, branding), the `Company`
  model, the automatic per-company query filter (`utils/tenant.js`), the `X-Company-Id`
  header, per-company tabs (`enabledTabs`, `TAB_DISABLED`) and the migration.
- Login / `/api/auth/me` no longer return `company`. `/api/auth/permission-tabs` returns all tabs.
- Office Wi-Fi is one list again (admin screen + `OFFICE_ALLOWED_IPS` / `OFFICE_ALLOW_PRIVATE_LAN`).
- Company name on payslip / settlement PDFs comes from `COMPANY_NAME` / `COMPANY_FINANCE_TITLE` in `.env`.
- Unique indexes are plain again (`staffId`, `payrollCode`, ...); old per-company ones are
  replaced automatically on start. The leftover `company` field on old records is ignored.
- A database that holds MORE than one company's data refuses to start; see
  `scripts/keepOneCompany.js` (back up first).

## Staff documents, photos, birthday wishes, letters (Oct 2026)
- **Documents + profile photo** (`models/StaffDocument.js`, `controllers/documentController.js`,
  `routes/documentRoutes.js`, mounted at `/api/documents`). Aadhaar card, PAN card, light bill and
  profile photo, stored in MongoDB (max 8 MB each, JPG/PNG/PDF; photo = image only). Staff manage
  their own (`/me`), admins any staff (`/staff/:staffId`, `/summary`). Files are served from signed
  links (`utils/fileSigning.js`): photo links never expire (new photo = new link), document links
  expire after 2 hours. `/api/documents` accepts 12 MB JSON bodies (everything else stays 2 MB).
- `Staff.photoUpdatedAt`; every staff response now includes `photoUrl` (null = show initials).
  Deleting a staff member deletes their documents.
- **Birthday wishes** (`models/BirthdayWish.js`): `POST /api/staff/birthdays/:id/wish` (only on the
  birthday, India date from 12:00 midnight; never yourself; once per year), `GET /api/staff/birthdays/my-wishes`.
  `GET /api/staff/birthdays/upcoming` now also returns `photoUrl`, `isSelf`, and for today's
  birthdays `wishCount`, `wishedByMe`, `canWish`.
- **Resignation**: approving sets the staff member's status to Relieved and `relievingDate` to the
  LAST WORKING DAY from the request (was never set). Optional `{ lastWorkingDay }` on approve to change it.
  Submitting a last working day in the past is refused.
- **Letters**: `GET /api/hrm/letters/issued[?type=]` (admin) — every letter generated so far.
- Payslip PDF file name: `<Staff_Name>_<Month>_<Year>.pdf` (e.g. `Suraj_Pal_October_2026.pdf`).
- `GET /api/hrm/advances` only returns the caller's own advances for staff logins.
- Note: `models/auth.js` is not a code file (it contains what looks like a server login) and is not
  used — delete it and change that password.

## Leave balances: month-wise from confirmation date (Oct 2026)
- Leave page (`GET /api/hrm/leave-policy/balances`, `/balances/me`) no longer shows the whole year's
  allowance. Paid / Sick / Casual are EARNED month by month from the confirmation month up to today
  (e.g. confirmed 01 Jun 2026, today 09 Oct 2026 -> 5 months -> Paid 7.5, Sick 2.5, Casual 2.5 at 18/6/6).
  Same numbers as the attendance calendar's balance line (which now uses the same rule).
- Leave already approved for later this year still counts as taken (`takenThroughYearEnd` option).
- `/balances/me` and new admin `GET /balances/staff/:staffId` include `monthly` (month-by-month earned /
  taken / balance ledger). The web Leave page shows it when a staff name is clicked.
- Excel-import backfill and auto-absence marking keep using `fullYearEntitlement` (unchanged).

## Update — 12 Oct 2026 (letters, birthdays, salary)
- **Offer / Joining / Confirmation letters** now use the company's own layout
  (`utils/hrLetters.js`, artwork in `assets/letters/`). Filled from the staff record:
  name with **Mr./Ms. from Gender**, designation, department, joining / confirmation date,
  probation months, work schedule, permanent + current address, mobile, e-mail,
  Aadhaar / PAN number (My Documents) and salary (Staff Basic Payroll, incl. history).
  New Staff fields: `gender`, `designation`, `department`, `address`, `currentAddress`, `workSchedule`.
  Optional `.env`: `COMPANY_EMAIL`, `COMPANY_ADDRESS`, `COMPANY_SIGNATORY`.
- **Birthday photos**: colleagues whose photo exists but whose record had no
  `photoUpdatedAt` (or whose photo is on a duplicate record with the same e-mail) now show their photo.
- **Salary 29/30 days fix**: joining / relieving dates are read as the India calendar day, so a date
  saved as IST midnight no longer cuts one day off the month.

## Update — 12 Oct 2026 (salary 29,000 with a full month present)

- **Calendar showed "Absent" days as Present.** An attendance row marked Absent (Edit Day / Excel import)
  was painted green and counted in "Present", while payroll (correctly) did not pay it. It now shows red
  (unpaid) and is no longer counted as present, so the calendar and the salary agree. The attendance
  self-heal also no longer cancels a leave sitting on an Absent day.
- **Holidays docked as absent.** The shared holiday lookup checked the UTC day but cached the answer under
  the India day, so a check between 00:00 and 05:30 IST stored yesterday's answer for today. Fixed, and
  payroll now also treats every day the calendar shows as Holiday (declared holidays + Saturday rule) as
  a paid day off.
- **Attendance key.** Payroll now finds a day's attendance with the same key as the calendar
  (`attendanceDayKey`), so a record with an old-format `date` is no longer docked as unmarked.
- Saved payrolls are not changed automatically — open the month again (or regenerate it) to see the new figure.

## Update — 12 Oct 2026 (2) — "30 present but 29/30 days paid"

- **Root cause:** payroll applied `relievingDate` even when the staff member is NOT Relieved. The Staff
  model keeps an old relieving date when the status changes back (withdrawn resignation, Relieved ->
  Confirmation), so a leftover date of 29 Sep cut September to 29/30 days (₹29,000) while the calendar
  showed every day. Payroll now uses the relieving date only for status "Relieved" — the same rule as the
  calendar, Add Payroll and the settlement. (Months after that leftover date, e.g. October, were also
  being paid ₹0; that is fixed by the same change.)
- `GET /api/hrm/payroll/calculate/:id/:period` now also returns `payableNote` explaining a short month
  (joining date / relieving date / month not finished).

## Update — 12 Oct 2026 (3) — Offer / Joining / Confirmation letters

- **Details form on Generate.** `GET /api/hrm/letters/staff/:staffId/:type/form` lists the letter's fields with
  their current values and which are MISSING; `POST …/:type/issue` now takes `{ details }`. Only missing details
  are asked (name, gender → Mr./Ms., designation, joining / confirmation date, salary per probation month,
  Aadhaar, PAN, address…). Empty profile fields are saved to the staff record; all values are kept with the
  issued letter (`issuedLetters[].details`) and used for the PDF. Aadhaar / PAN typed once are reused for that
  person's other letters. Offer / Joining / Confirmation can now be generated even when a date was missing.
- **Same layout as the company letters:** exact top / bottom bands and the "Your Virtual Office" logo (offer),
  confirmation bands on page 1 top / page 2 bottom with the watermark, page 2 with applicant name + sign on
  the left, details box on the right and partner logos; blue signature box with arrow on the offer.
  New assets in `assets/letters/`.
