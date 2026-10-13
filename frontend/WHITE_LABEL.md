# Multi-company (website)

- Super admin logs in → **Companies** page (`/companies`): every company as a card.
  Add / edit / deactivate / delete, or **click one to open it**.
- Once a company is open, the whole website shows only that company
  (`X-Company-Id` is sent with every request, see `src/utils/api.js`).
  Sidebar shows the open company with **Switch company**.
- Admins and staff never see this: they log in straight into their own company.
- Branding (logo / colours) is per company: Companies page for the basics,
  *Company Branding* in the sidebar for everything else.
- Login page for a company: `https://your-site/login?company=<link name>`.
- Admins now also send attendance heartbeats (the super admin never does).
- Office Wi-Fi box has a manual "add IP / range" field (for IPv6 networks).
- Office Wi-Fi is set per company in the Add / Edit company form (with a
  "Use this computer's network" button), and each card shows whether one is set.
- Tabs per company: tick them in the Add / Edit company form. Sidebar, dashboard cards, quick links, routes and
  the staff self-service screens (My Payslips, My Attendance, My Leave, My Resignation) follow the company's tabs.
  The saved login is refreshed from `/api/auth/me` on every page load, so changes apply without logging in again.
