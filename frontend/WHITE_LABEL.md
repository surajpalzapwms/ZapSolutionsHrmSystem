# White label (multi-company) — website

## Super admin
- Logs in at `/login` → **Companies** page (`/companies`) when there is more
  than one company (with exactly one, it opens straight away).
- **Add company**: name + country (India 🇮🇳, Saudi Arabia 🇸🇦, Qatar 🇶🇦, Other)
  and, optionally, the company's first admin login. The country sets the
  currency, time zone, weekly off days and which registration numbers are
  asked for.
- Each company card: logo, country, currency, login link (copy), staff /
  admin counts, staff limit, **profile completeness**; buttons to **Open**,
  open the **Company Profile**, manage **admin logins**, **edit** (link name,
  tabs, staff limit, own domain, office Wi-Fi), **activate / deactivate**,
  delete (empty companies only).
- Once a company is open, the whole website works on that company only
  (`X-Company-Id` header, `src/utils/api.js`). The sidebar shows the open
  company with a **switch** button.

## Company admin
- Logs in at their company's link: `https://your-site/login?company=<link name>`
  (their logo, colours and Arabic name are shown). Staff can log in with
  their Staff ID there too.
- **Company Profile** (sidebar, needs the *Settings* tab): Branding · Address &
  contact · Registration & tax (fields depend on the country) · Country &
  payroll (currency, number format, time zone, weekly off days) · Letters &
  payslips (signatory, signature, stamp). Live preview on the right.

## What follows the company automatically
- Logo, colours, browser-tab icon and title, currency everywhere.
- Weekly off days and time zone in calendars, leave and attendance screens
  (`isWeeklyOffDow`, `companyTimeZone`, `tzOffsetMs` in `src/utils/brand.js`).
- Payroll allowance / deduction lists (PF / ESI / TDS in India; GOSI / SANED
  in Saudi Arabia; GRSIA in Qatar) — `payrollTypesFor()` in `src/utils/constants.js`.
- Tabs the company doesn't have are hidden (sidebar + routes) for everyone.
- A deactivated company is logged out with a message on the login page.

## Files
- `src/components/companies/Companies.jsx` — super admin company list.
- `src/components/settings/Settings.jsx` — Company Profile.
- `src/utils/company.js` — open company (super admin), login links.
- `src/utils/brand.js` — brand store + company time zone / weekly off helpers.
- `src/services/companyService.js` — `/api/company` calls.
