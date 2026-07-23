// src/types/index.js
export const Holiday = {
  _id: "",
  name: "",
  startDate: "",
  endDate: "",
  description: "",
  yearCode: [],
  createdAt: "",
  updatedAt: "",
};

export const Payroll = {
  _id: "",
  payrollCode: "",
  staffId: "",
  staffName: "",
  period: "",
  basicSalary: 0,
  allowances: [],
  totalAllowance: 0,
  deductions: 0,
  netSalary: 0,
  status: "pending",
  paymentMethod: "",
  bankAccount: "",
  paymentDate: "",
  remarks: "",
  sources: [],
  payrollType: "current",
  createdAt: "",
  updatedAt: "",
};

export const Staff = {
  _id: "",
  staffId: "",
  staffName: "",
  projectName: "",
  contactNo: "",
  email: "",
  password: "",
  date: "",
  isActive: true,
  createdAt: "",
  updatedAt: "",
};

export const Attendance = {
  _id: "",
  userId: "",
  loginTime: "",
  logoutTime: "",
  totalTime: "",
  isLeaveDay: false,
  attendanceType: "full",
  extraHoursInMinutes: 0,
  createdAt: "",
  updatedAt: "",
};

export const Leave = {
  _id: "",
  userId: "",
  leaveDate: "",
  reason: "",
  leaveType: "unpaid",
  status: "pending",
  createdAt: "",
  updatedAt: "",
};

export const StaffBasicPayroll = {
  _id: "",
  staffId: "",
  staffName: "",
  currentBasicSalary: 0,
  currentEffectiveFrom: "",
  remarks: "",
  salaryHistory: [],
  createdAt: "",
  updatedAt: "",
};

export const Advance = {
  _id: "",
  staffId: "",
  staffName: "",
  amount: 0,
  date: "",
  reason: "",
  status: "pending",
  repaidAmount: 0,
  remarks: "",
  createdAt: "",
  updatedAt: "",
};