# Multi-company (white label)

One backend + one database now serves many companies.

## How it works
- Every record has a `company`. Every query is limited to the current company
  automatically (`utils/tenant.js`), so one company can never read, change or
  delete another company's data — even if a controller forgets to filter.
- Staff / admins belong to one company (taken from their account).
- The **super admin** belongs to none. After login they see **all companies**
  (`GET /api/company`), click one, and the website sends `X-Company-Id` with
  every request. Data routes without it answer `COMPANY_REQUIRED`.
- `staffId`, `payrollCode`, office Wi-Fi, leave policy, holidays, etc. are
  unique **per company**. Login e-mails stay unique across all companies.
- Branding (name, logo, colours) is stored on the company.

## Endpoints (`/api/company`)
| | |
|---|---|
| `GET /branding?slug=` or `?id=` | public, login page |
| `PUT /branding` | super admin, company open |
| `GET /` | super admin: all companies + staff counts |
| `POST /` | add company `{ name, slug?, ...branding }` |
| `PUT /:id` | edit / activate / deactivate |
| `DELETE /:id` | only a company with no staff and no logins |

## Upgrading an existing database
**Back up first.** On first start, every old record (no company yet) is given to
one company: the first existing one, or a new one named from the old branding /
`COMPANY_NAME`. The super admin stays company-less. Safe to restart. Old
single-company unique indexes are replaced by per-company ones automatically.

## Office Wi-Fi per company
- The super admin sets a company's office Wi-Fi when adding / editing it
  (`officeNetworks`: array or comma / newline text on `POST` / `PUT /api/company`),
  or the company admin does it in Live presence. Both write the same per-company list.
- `GET /api/company` returns `officeNetworks` for each company.
  `GET /api/company/my-network` returns the address of the caller's network.
- Addresses are validated (IPv4 / IPv6 / CIDR), max 20 per company.
- `OFFICE_ALLOWED_IPS` and `OFFICE_ALLOW_PRIVATE_LAN` in `.env` are not per company, so they
  only apply while there is ONE company. With more, each company uses its own list
  (or set `OFFICE_ENV_FOR_ALL_COMPANIES=true` to share them on purpose).

## Tabs per company
- The super admin picks which tabs each company has (`enabledTabs` on `POST` / `PUT /api/company`,
  `null` = all tabs). `GET /api/company` (super admin only) returns `enabledTabs` + `tabTree`.
- Enforced on the server, so it holds for the website AND the mobile app:
  - `protect` refuses any API area of a switched-off tab with `403 { code: "TAB_DISABLED" }`
    (rules in `config/permissions.js` → `COMPANY_ROUTE_RULES`). Staff list, holidays and login are always on.
  - `requireTabAccess` / `hasTabAccess(user, key, company)` also check the company, so a tab the company
    doesn't have is refused even for an admin with "all tabs" and for the super admin inside that company.
  - No Attendance tab = no sign in/out, no automatic attendance (login check-in, `/api/presence`, PC agent).
- `/api/auth/login` and `/api/auth/me` return `company.enabledTabs` (the app should hide tabs the same way).
- Admin Permissions only lists the company's tabs, and can only hand out those.
- Only the super admin sees the company list (`/api/company`); a company's admin only ever sees their own company.
