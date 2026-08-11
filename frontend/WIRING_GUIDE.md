# Observability Dashboard — Wiring Guide
# ─────────────────────────────────────────────────────────────
# After placing the .jsx files, apply these 3 changes to wire everything up.
# ─────────────────────────────────────────────────────────────


## 1. FILE PLACEMENT

Place these files:
  ObservabilityDashboard.jsx  →  frontend/src/pages/Observability/ObservabilityDashboard.jsx
  ObservabilityLayout.jsx     →  frontend/src/pages/ObservabilityLayout.jsx


## 2. App.jsx — add imports + route

Add these imports near the top of App.jsx (with the other layout/page imports):

```jsx
import ObservabilityLayout from "./pages/ObservabilityLayout";
import ObservabilityDashboard from "./pages/Observability/ObservabilityDashboard";
```

Then add this route inside the main protected <Route path="/"> block,
alongside the other layout routes like "purchaselayout", "salelayout" etc:

```jsx
{/* Observability routes */}
<Route path="observabilitylayout" element={<ObservabilityLayout />}>
  <Route index element={<ObservabilityDashboard />} />
  <Route path="events" element={<ObservabilityDashboard tab="events" />} />
  <Route path="audit" element={<ObservabilityDashboard tab="audit" />} />
  <Route path="reconciliation" element={<ObservabilityDashboard tab="reconciliation" />} />
</Route>
```


## 3. Sidebar.jsx — add nav entry

In Sidebar.jsx, add the "Activity" or "Eye" icon to your imports (it already imports Eye):

Find a good place in the sidebar nav (e.g. after "user-activity" or near settings),
and add a nav item like this:

```jsx
// Inside your sidebar nav items array/JSX, add:
{
  key: "observability",
  label: "Observability",
  icon: Eye,
  path: "/observabilitylayout",
  // Only show to admins if desired:
  // adminOnly: true,
}
```

If Sidebar builds nav items dynamically, find the section where items like
"user-activity" or "dashboard" are defined and add a similar object there.

The exact structure depends on how your sidebar renders items — look for the
array of { label, icon, path } objects and add this entry.


## 4. Quick integration check

After wiring, verify:
  1. Navigate to /observabilitylayout — dashboard loads
  2. Events tab shows data from /api/observability/events
  3. Clicking a row opens the detail drawer
  4. Audit tab shows data from /api/observability/audit
  5. Reconciliation tab has a "Run" button that calls POST /api/observability/reconciliation/run


## 5. Backend integration status

✅ Already integrated (emitEvent + auditChange):
  - routers/sale/saleSummary.js
  - routers/sale/saleReturn.js
  - routers/purcharsing/purcharsing.js
  - routers/purcharsing/purchaseReturn.js
  - routers/expenses/addExpense.js
  - routers/hrm/payroll.js
  - routers/stock/stockAdjustment.js
  - routers/stock/stockReturn.js
  - routers/stock/stockTransfer.js
  - routers/stock/stockTransferToMRRoutes.js
  - routers/accounts/transaction.js

⚠️ NOT yet integrated (write-heavy routes worth adding):
  - routers/sale/outstanding.js       (OUTSTANDING_CREATED / OUTSTANDING_UPDATED)
  - routers/purcharsing/paymentOut.js (PAYMENT_UPDATED)
  - routers/accounts/accounts.js      (if it has POST/PUT/DELETE)
  - routers/accounts/mrCashRoutes.js

📌 Reports routers are GET-only — no need for emitEvent there.
📌 Master/settings routes are low-priority but can be added later.