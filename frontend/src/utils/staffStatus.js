// src/utils/staffStatus.js
//
// One rule, used everywhere, for "has this staff member left the
// organization?" — status "Relieved" and a relieving date that is today or
// earlier (a relieving date still in the future means they are serving
// their notice period and still work here). "Relieved" with no relieving
// date recorded counts as left.

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export const hasLeftOrganization = (staff) => {
  if (!staff || staff.status !== "Relieved") return false;
  if (!staff.relievingDate) return true;
  const relieving = new Date(staff.relievingDate);
  if (isNaN(relieving.getTime())) return true;
  relieving.setHours(0, 0, 0, 0);
  return relieving <= startOfToday();
};

export const isCurrentStaff = (staff) => !hasLeftOrganization(staff);

// Status to *display*. A staff member marked "Relieved" whose Relieved Date
// is still in the future is serving notice — they are still confirmed staff,
// so they keep showing "Confirmation" until the leaving date arrives, then
// automatically read "Relieved". Stored data is never changed by this.
export const getDisplayStatus = (staff) => {
  if (!staff) return "Probation";
  if (staff.status === "Relieved" && staff.relievingDate) {
    const relieving = new Date(staff.relievingDate);
    if (!isNaN(relieving.getTime())) {
      relieving.setHours(0, 0, 0, 0);
      if (relieving > startOfToday()) return "Confirmation";
    }
  }
  return staff.status || "Probation";
};
