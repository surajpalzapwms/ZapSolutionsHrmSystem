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
