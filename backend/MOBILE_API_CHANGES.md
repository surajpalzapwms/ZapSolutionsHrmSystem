# White label — what the mobile app should know (27 Oct 2026)

Nothing breaks for an app that ignores this; these make it complete:

- **Login** `POST /api/auth/login` accepts `company: "<link name>"`. Send it
  when the user typed a **Staff ID** (Staff IDs are unique per company only).
  Without it, a Staff ID that exists in two companies returns
  `400 STAFF_ID_AMBIGUOUS` → ask for the e-mail or the company.
- Login and `/api/auth/me` return `company: { _id, name, slug, country,
  currencyCode, timeZone, weeklyOffDays, logoUrl, primaryColor, sidebarColor,
  rtl, enabledTabs }`. Use `weeklyOffDays` (0 = Sunday) instead of assuming
  Sunday, and `timeZone` for "today".
- `GET /api/settings` with the login token returns **that user's company**
  branding / currency. `logoUrl` is now an https URL (cache it).
- New error codes: `403 COMPANY_INACTIVE` (log out, show the message),
  `403 TAB_DISABLED` (hide that feature), `403 COMPANY_MISSING`.
- Super admin on the app: with several companies, send `X-Company-Id`
  (from `GET /api/company`) on every request, otherwise data routes answer
  `400 COMPANY_REQUIRED`. With one company nothing changes.
- Staff document labels (`label` in `/api/documents/*`) follow the company's
  country: Aadhaar / PAN in India, Iqama / Passport in Saudi Arabia, QID /
  Passport in Qatar. Show the label from the API.

# New endpoints for the mobile app

All need the normal `Authorization: Bearer <token>` header.

## Salary Slip tab (only PAID months)
GET /api/hrm/payroll/salary-slips
-> { data: [{ _id, period, periodLabel, netSalary, paidOn, paymentMethod, downloadUrl }] }
Download: GET {downloadUrl}  (PDF, = /api/hrm/payroll/:id/payslip-export)

## Letters (Joining, Offer, Confirmation, Termination, Leaving, Experience)
GET /api/hrm/letters
-> { data: [{ type, title, available, date, reason }] }
   type = offer | joining | confirmation | termination | leaving | experience
   Show the tile disabled with `reason` when available = false.
Download: GET /api/hrm/letters/:type/download   (PDF)
Admin only: add ?staffId=<id> to either call for another staff member.

Rules:
- offer, joining: when the joining date is set
- confirmation: once the confirmation date has passed
- leaving, experience: when status = Relieved with a relieving date
- termination: Relieved WITHOUT an approved resignation

## Upcoming birthdays (same card layout as Upcoming holidays)
GET /api/staff/birthdays/upcoming?days=60
-> { data: [{ _id, staffName, projectName, date: "YYYY-MM-DD", daysUntil, isToday }] }
Only name/team/day are returned — no birth year.

## Security fix
GET /api/hrm/payroll/:id now returns 403 to a staff member opening someone
else's payroll record (admins unchanged).
