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
