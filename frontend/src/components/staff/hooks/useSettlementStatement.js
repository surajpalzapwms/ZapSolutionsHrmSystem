// src/components/staff/hooks/useSettlementStatement.js
import { useEffect, useRef, useState } from "react";
import { staffService } from "../../../services/staffService";
import { payrollService } from "../../../services/payrollService";
import { advanceService } from "../../../services/advanceService";
import { getPendingSalary, unwrapList } from "../../../services/pendingSalaryService";
import {
  mergePendingIntoSettlement,
  salaryEstimatesFromSettlement,
} from "../../../utils/settlementMerge";

// A statement already opened is reused for a short while, so picking the same
// staff member again (or flipping A -> B -> A) is instant instead of
// recalculating everything. Kept per screen visit (not global), so coming
// back to the page after paying salary elsewhere always loads fresh figures.
const REUSE_MS = 60 * 1000;

// Backend statement + the "Pending Amount" months, merged so months and totals
// match the mobile app exactly. Everything that doesn't depend on the
// statement (payroll list, advances) is requested at the SAME time, and the
// salary the statement already calculated is reused — so no extra
// per-month salary request is made for the months it already covers.
const loadStatement = async (staff) => {
  const employeeId = staff._id;
  const [res, payrollRes, advancesRes] = await Promise.all([
    staffService.getSettlement(employeeId),
    payrollService.getAll({ employeeId }).catch(() => null),
    advanceService.getAll({ employeeId }).catch(() => null),
  ]);

  const base = res.data?.data || null;
  if (!base) return null;

  const pending = await getPendingSalary({
    employeeId,
    joiningDate: staff.date || staff.joiningDate || null,
    relievingDate: staff.relievingDate || null,
    hasLeft: true,
    // null -> getPendingSalary fetches it itself (only if the early request failed)
    payroll: payrollRes ? unwrapList(payrollRes.data) : null,
    advances: advancesRes ? advancesRes.data : null,
    salaryByPeriod: salaryEstimatesFromSettlement(base),
  }).catch(() => null);

  return mergePendingIntoSettlement(base, pending);
};

// Loads the statement for one staff member. Pass `enabled=false` (or no
// staff) to stay idle.
export const useSettlementStatement = (staff, enabled = true) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const reuse = useRef(new Map()); // staff _id -> { at, promise }

  useEffect(() => {
    if (!enabled || !staff?._id) {
      setLoading(false);
      setError("");
      setData(null);
      return undefined;
    }
    let cancelled = false;
    setError("");

    let entry = reuse.current.get(staff._id);
    if (!entry || Date.now() - entry.at > REUSE_MS) {
      const promise = loadStatement(staff);
      entry = { at: Date.now(), promise };
      reuse.current.set(staff._id, entry);
      // never keep a failed / empty result
      promise
        .then((d) => {
          if (!d && reuse.current.get(staff._id) === entry) reuse.current.delete(staff._id);
        })
        .catch(() => {
          if (reuse.current.get(staff._id) === entry) reuse.current.delete(staff._id);
        });
    }

    // Show the old statement of this staff member immediately when we have it.
    setData(null);
    setLoading(true);
    entry.promise
      .then((d) => {
        if (cancelled) return;
        setData(d);
        if (!d) setError("Settlement statement is not ready yet.");
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err.response?.data?.message ||
              "Couldn't load the settlement statement. Please try again.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // other staff fields used above only change with the id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, staff?._id]);

  return { loading, error, data };
};
