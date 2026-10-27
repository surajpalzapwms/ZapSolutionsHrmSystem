# Late coming — per-minute salary deduction

## Rule

* Office time = the staff member's shift (`User.shiftStartTime` / `shiftEndTime`,
  default **10:00 AM – 6:30 PM**; qualifying Saturdays 10:00 AM – 4:00 PM).
* The **first 15 minutes** after shift start are a buffer — signing in up to 10:15 is never late.
* Every minute after the buffer is deducted at the **per-minute salary**:
  `per-minute = (basic ÷ days in month) ÷ net shift minutes` (465 min for 10:00–6:30, lunch excluded).
* **Make-up:** minutes signed in after shift end on the *same day* cancel late minutes.

```
deducted minutes = max(0, late minutes − 15 − minutes stayed after shift end)
```

| Sign in | Sign out | Late | Stayed extra | Deducted |
|---|---|---|---|---|
| 10:15 | 6:30 | 15 | 0 | 0 (buffer) |
| 10:20 | 6:30 | 20 | 0 | **5 min** |
| 10:20 | 6:50 | 20 | 20 | 0 (full salary) |
| 10:40 | 6:40 | 40 | 10 | **15 min** |

Only real worked days count (not Half Day, Absent, leave, Sundays or holidays).
Today's open record shows as **Pending** and is not deducted until sign-out.

## Super admin control

* **Month-wise:** switch "Deduct from salary this month" ON/OFF (default ON) —
  `PUT /api/hrm/late-deduction/month { staffId, period: "YYYY-MM", deductLate }`
* **Date-wise:** "Don't deduct" / "Deduct" on each late date —
  `PUT /api/hrm/late-deduction/day { staffId, date: "YYYY-MM-DD", waived }`
* Both are **super admin only** (`allowSuperAdminOnly`). A still-pending saved payroll is recalculated automatically.

Admins can read a month: `GET /api/hrm/late-deduction/:staffId/:period`.

## Where it shows

* `calculateSalary` subtracts it from `netSalary` and returns `lateDeduction`, `lateMinutes`,
  `lateDays`, `lateDeductionEnabled`, and `lateSummary` (salary preview, payroll create/recalculate, settlement).
* The calendar payload (`/leaves/staff-summary/:id/calendar`, `/leaves/my-attendance/calendar`) adds
  `days[n].late` per date and `lateSummary` for the month (`months[i].lateSummary` in annual mode).
* Payroll `attendanceInfo` stores `lateDeduction`, `lateMinutes`, `lateDays`, `lateDeductionEnabled`.

## Files

* `services/lateDeduction.js` — all the math (one place, used by payroll + calendar)
* `models/LateDeductionSetting.js` — month switch; `models/Attendance.js` — `lateDeductionWaived`
* `controllers/lateDeductionController.js`, `routes/lateDeduction.js`, mounted in `server.js`
* `controllers/payrollController.js`, `controllers/leave.js`, `models/Payroll.js`

## Lunch (1:30–2:15 PM, 45 min)

Lunch is normally not working time. Super admin can record it per late date:

* **No lunch** switch — lunch not taken, the whole 45 min counts as working time.
* **Taken (min)** — lunch taken, the unused part of the 45 min counts (30 min taken → 15 min credit).
  Taking more than 45 min adds no extra penalty.

```
deducted minutes = max(0, late − 15 − stayed after shift − lunch credit)
```

* Applied **only when a deduction is generated** — a day already made up by staying late ignores lunch.
* Only the part of the lunch window the staff member was signed in counts (sign-in after 2:15 PM → no credit).
* `PUT /api/hrm/late-deduction/lunch { staffId, date, lunchSkipped, lunchTakenMinutes }` (super admin only).
* Summary adds `lunchSkippedDays`, `lunchTakenDays`, `totalLunchTakenMinutes`, `totalLunchCreditMinutes`; each date adds
  `deductibleBeforeLunch`, `lunchSkipped`, `lunchTakenMinutes`, `lunchCreditMinutes`, `lunchEligible`.
