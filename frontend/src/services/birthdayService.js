// src/services/birthdayService.js — upcoming birthdays + birthday wishes.
// Same endpoints the mobile app uses, so a wish sent from the website shows
// in the app and the other way round.
import api from "../utils/api";

export const birthdayService = {
  // [{ _id, staffName, projectName, date: "YYYY-MM-DD", daysUntil, isToday,
  //    isSelf, photoUrl, wishCount?, wishedByMe?, canWish? }]
  getUpcoming: (days = 60) =>
    api.get("/api/staff/birthdays/upcoming", { params: { days, _t: Date.now() } }),
  // Only on the birthday itself (from 12:00 midnight India time).
  wish: (staffId, message) => api.post(`/api/staff/birthdays/${staffId}/wish`, { message }),
  // Wishes the logged-in staff member received this year.
  getMyWishes: () => api.get("/api/staff/birthdays/my-wishes", { params: { _t: Date.now() } }),
};
