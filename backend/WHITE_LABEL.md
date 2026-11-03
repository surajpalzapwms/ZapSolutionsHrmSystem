# White label (multi-company) — backend

One backend + one MongoDB database serves many client companies (India, Saudi
Arabia, Qatar …). Every company has its own staff, attendance, leave, payroll,
holidays, office Wi-Fi, branding and settings, and can never see another
company's data.

## Who does what

| Role | Can |
|---|---|
| **Super admin** (platform owner, belongs to no company) | Create a company with a **name + country**, send a **one-time invite link** so the company's admin creates their own login, open any company, edit the company profile, activate / deactivate, choose tabs, set a staff limit, own login domain, delete an empty company. |
| **Company admin** (the ONE admin of a company) | Complete / edit their **own** company profile: logo, colours, Arabic name, address, registration & tax numbers, currency, time zone, weekly off days, signatory, signature, stamp. Create **branches** and send a one-time invite link for each branch's admin. |
| **Branch admin** (the ONE admin of a branch) | Manage the **staff of their own branch only**. Cannot manage branches, invite admins or edit the company profile. |
| **Staff** | Only ever see their own company. |

## Country presets (`config/countries.js`)

Picking a country fills these in (all still editable on the profile):

| | India | Saudi Arabia | Qatar |
|---|---|---|---|
| Currency | INR | SAR | QAR |
| Time zone | Asia/Kolkata | Asia/Riyadh | Asia/Qatar |
| Weekly off | Sunday | Friday + Saturday | Friday + Saturday |
| Registration numbers | GSTIN, PAN, TAN, CIN, EPF, ESIC, PT | CR No., Unified no. (700), VAT (TRN), GOSI, MHRSD/Qiwa, Muqeem | CR No., Establishment ID, TIN, Trade licence, WPS ID |
| Staff ID documents | Aadhaar, PAN, light bill | Iqama / National ID, Passport, National Address | QID, Passport, Kahramaa bill |

Registration numbers are validated (e.g. Saudi VAT = 15 digits starting and
ending with 3, GSTIN format) and the ones marked `print` appear in the footer
of letters and payslips.

**Time zone and weekly off days are per company.** Attendance days, late
marks, auto sign-out, leave, sandwich rules, payroll working days, birthdays
and letter dates all use the company's own time zone and off days (the old
hard-coded India time / Sunday is gone).

## How isolation works

- `utils/tenant.js` — a global mongoose plugin. Every query, aggregate,
  insert and update is automatically limited to the current company, so a
  controller cannot leak data even if it forgets to filter. Unique indexes
  are made per company automatically (`{ staffId }` → `{ company, staffId }`),
  so two companies can both have staff `EMP001`. Login e-mails stay unique
  across all companies.
- `middleware/auth.js → protect()` works out the company of every request and
  runs the rest of the request inside it:
  - admin / staff → their own company (header ignored);
  - super admin → the `X-Company-Id` header (the website sends it after a
    company is opened). With only ONE company it is used automatically.
    Without one, data routes answer `400 COMPANY_REQUIRED`.
  - deactivated company → `403 COMPANY_INACTIVE` (also at login);
  - a tab the company doesn't have → `403 TAB_DISABLED`.
- Background jobs (absence reconciliation, presence sweep, cache warm-up) run
  once per active company (`forEachCompany`).
- In-memory caches (holiday checks, office Wi-Fi, response cache, calendar
  heal, staff visibility) are keyed per company, and a save in one company
  only clears that company's caches.
- `services/companyRegistry.js` keeps every company's settings in memory
  (refreshed on save and every minute), so time zone / weekly off look-ups
  cost no database query.

## API (`/api/company`)

| Method & path | Who | |
|---|---|---|
| `GET /countries` | public | country presets for the forms |
| `GET /branding?company=<slug>` | public | login page branding (also by `?id=`, `X-Company-Id`, token, or the site's custom domain) |
| `GET /logo/:id?v=` | public | the uploaded logo (cached for a year, URL changes when the logo changes) |
| `GET /profile` | company admin / super admin | full profile + the legal-number fields for its country |
| `PUT /profile` | admin with *Settings* tab / super admin | save profile (logo / signature / stamp as PNG/JPG data URLs, `""` removes) |
| `GET /` | super admin | all companies with staff / admin counts, profile completeness |
| `POST /` | super admin | `{ name, country, slug?, inviteAdmin?: true, enabledTabs?, maxStaff?, customDomain?, officeNetworks? }` — with `inviteAdmin` the answer also has `invite.token` (shown once) |
| `PUT /:id` | super admin | any profile field + `slug`, `isActive`, `enabledTabs`, `maxStaff`, `customDomain`, `officeNetworks` |
| `GET /:id/admins` | super admin | the company's admin and its branch admins |
| `GET/POST /:id/admin-invites`, `DELETE /:id/admin-invites/:inviteId` | super admin | list / create / cancel the one-time link for THE company admin (refused while the company already has an admin) |
| `DELETE /:id` | super admin | only a company with no staff and no logins |

`GET /api/settings` (public) and `PUT /api/settings` still work and now return
/ save the **caller's company** profile (registration numbers only for
logged-in callers).

Login: `POST /api/auth/login { identifier, password, company?: "<slug>" }`.
Staff IDs are unique per company, so a Staff-ID login uses the company of the
login link; if the same Staff ID exists in two companies and no company is
given, the answer is `400 STAFF_ID_AMBIGUOUS` ("log in with your e-mail").
The response (and `/api/auth/me`) contains `company: { _id, name, slug,
country, currencyCode, timeZone, weeklyOffDays, logoUrl, primaryColor,
sidebarColor, rtl, enabledTabs }`.

## Documents

- Payslip PDF: company logo + name in the header, company colours, printed
  registration numbers in the footer, amounts in the company's currency.
- HR letters: companies other than ZAP get a clean letterhead in their own
  colours with their logo, signatory name / title, uploaded signature and
  stamp, address and CR / VAT / GSTIN footer. The ZAP Solutionz artwork is
  only used for a company whose name starts with "ZAP".

## Upgrading an existing (single-company) database

**Back up first.** On the first start:
1. every record without a company is given to one company (the first one, or
   a new one named from the old Settings page / `COMPANY_NAME`);
2. the old Settings values (logo, colours, address …) are copied onto it;
3. inline logos move to `logoData` (served from `/api/company/logo/:id`);
4. old unique indexes are replaced by per-company ones.

Safe to restart — nothing happens the second time. The super admin login
stays company-less.

## .env (optional)

| Variable | |
|---|---|
| `DEFAULT_COUNTRY` | country used for migrated data / when none is chosen (default `IN`) |
| `DEFAULT_TIMEZONE` | time zone for migrated data (default `Asia/Kolkata`) |
| `OFFICE_ALLOWED_IPS`, `OFFICE_WIFI_NAMES`, `OFFICE_ALLOW_PRIVATE_LAN` | only applied while there is ONE company (they aren't per company). Set `OFFICE_ENV_FOR_ALL_COMPANIES=true` to apply them to every company on purpose. |
| `COMPANY_*` | only defaults for a company that hasn't filled a field in |

## Scripts

Scripts in `scripts/` run outside a request, so they see **all companies**.
Run them with care (or wrap their work in `runWithCompany(companyId, …)`).


## Admin invite links, one admin per company, branches

**Admin logins are never created with a typed password any more.** The person
creates their own login from a one-time link.

| Step | Who | Endpoint |
|---|---|---|
| Make the company-admin link | super admin | `POST /api/company/:id/admin-invites` `{ email?, days? }` → `{ token }` |
| Make a branch-admin link | company admin | `POST /api/branches/:id/admin-invites` `{ email?, days? }` → `{ token }` |
| Open the link | anyone with it (public) | `GET /api/invites/:token` |
| Create the login | the invited person (public) | `POST /api/invites/:token/accept` `{ firstName, lastName?, email, password (8+), contactNumber? }` |

The website link is `<site>/invite/<token>`.

- **One time.** The accept step claims the link with one atomic update
  (`usedAt: null → now`), so two people opening it together cannot both
  succeed. If the account cannot be created (e.g. e-mail taken) the claim is
  given back. Links expire (default 7 days, max 30), can be locked to one
  e-mail, and a new link cancels the older unused one. Only a SHA-256 hash of
  the token is stored (`models/AdminInvite.js`); the plain token is returned
  once, when the link is created.
- **One admin per company / per branch.** Checked in `services/adminRules.js`
  and enforced by partial unique indexes on `User` (`adminScope: "company"` →
  unique `company`; `adminScope: "branch"` → unique `branch`). The old ways to
  make an admin are closed: `POST /api/company/:id/admins` is gone, "Make
  Admin" on the staff form is refused (400), and promoting staff from the
  Permissions screen is refused (409). To replace an admin: *Revoke* them on
  the Permissions screen, then make a new link.
- **Branches** (`models/Branch.js`, `/api/branches`, company admin or the
  super admin with a company open). A branch admin is `role: "admin"` with
  `branch` set. `Staff.branch` is stamped on create; a branch admin's Staff
  queries / aggregates / creates are limited to their branch by
  `utils/tenant.js` (`runWithCompany(companyId, fn, { branchId })`). A company
  admin can pick a branch on the staff form and filter `GET /api/staff?branch=`.
- **Branch admin access.** `allowAdminOnly` lets a branch admin reach only
  `/api/staff` (the only per-branch area). Attendance, leave, payroll, letters,
  documents, holidays, office Wi-Fi etc. answer `403 BRANCH_ADMIN_FORBIDDEN`
  because they are still company-wide. When a module is made per-branch, add
  its prefix to `BRANCH_ADMIN_ALLOWED_PREFIXES` in `middleware/auth.js`.
  A deactivated branch locks its admin out.

### Upgrading an existing database

Nothing to migrate. Existing admins keep working and are treated as the
company admin (no branch). A company that already has **more than one** admin
keeps them (nothing is deleted), but cannot get a new admin link until it is
down to zero, and no more can be added. New indexes are created on start.
