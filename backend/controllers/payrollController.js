import Payroll from "../models/Payroll.js";
import Staff from "../models/Staff.js";
import StaffBasicPayroll from "../models/StaffBasicPayroll.js";
import StaffAdvance from "../models/StaffAdvance.js";
import Account from "../models/Account.js";
import Leave from "../models/Leave.js";
import mongoose from "mongoose";

// Helper functions
const toFixedAmount = (value) => {
  const num = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(num)) return 0;
  return Math.round(num * 100) / 100;
};

const toExactAmount = (value) => {
  const num = typeof value === "number" ? value : parseFloat(value);
  if (isNaN(num)) return 0;
  return num;
};

const generatePayrollCode = async () => {
  const latest = await Payroll.findOne({}).sort({ createdAt: -1 });
  let nextNumber = 1;
  if (latest?.payrollCode) {
    const match = latest.payrollCode.match(/PR-(\d+)/);
    if (match) nextNumber = parseInt(match[1]) + 1;
  }
  return `PR-${nextNumber.toString().padStart(4, "0")}`;
};

// "YYYY-MM" -> previous "YYYY-MM"
const getPreviousPeriod = (period) => {
  const [year, month] = period.split("-").map(Number);
  const d = new Date(year, month - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const calculateSalary = async (employeeId, period, session) => {
  const employee = await Staff.findById(employeeId).session(session);
  if (!employee) throw new Error("Employee not found");

  const basicPayroll = await StaffBasicPayroll.findOne({ employeeId }).session(
    session,
  );
  if (!basicPayroll) throw new Error("Basic payroll not found");

  const fullBasicSalary = toExactAmount(basicPayroll.currentBasicSalary || 0);
  const [year, month] = period.split("-").map(Number);
  const totalDaysInMonth = new Date(year, month, 0).getDate();
  const perDaySalary = fullBasicSalary / totalDaysInMonth;

  const periodStart = new Date(year, month - 1, 1);
  const periodEnd = new Date(year, month, 0);

  // If this staff member's last working day falls inside (or before) this
  // period, only pay through that date instead of the full month.
  let payableDays = totalDaysInMonth;
  let effectivePeriodEnd = periodEnd;
  if (employee.relievingDate) {
    const relievingDate = new Date(employee.relievingDate);
    if (relievingDate < periodStart) {
      // Already left before this period started — nothing payable this month.
      payableDays = 0;
    } else if (relievingDate <= periodEnd) {
      payableDays = relievingDate.getDate();
      effectivePeriodEnd = relievingDate;
    }
  }

  // Calculate unpaid leaves (only up through the last payable day)
  const startDate = periodStart;
  const endDate =
    effectivePeriodEnd < periodEnd ? effectivePeriodEnd : periodEnd;
  const leaves =
    payableDays > 0
      ? await Leave.find({
          userId: employeeId,
          leaveDate: { $gte: startDate, $lte: endDate },
          status: "approved",
          leaveType: "unpaid",
        }).session(session)
      : [];

  const unpaidLeaveDays = leaves.length;
  const leaveDeduction = unpaidLeaveDays * perDaySalary;
  const effectiveDays = Math.max(0, payableDays - unpaidLeaveDays);
  const netSalary = Math.max(0, perDaySalary * effectiveDays);

  // Get pending advances (unpaid balance = amount - repaidAmount)
  const advances = await StaffAdvance.find({
    employeeId,
    status: { $in: ["pending", "approved"] },
  }).session(session);

  const outstandingAdvance = advances.reduce(
    (sum, a) =>
      sum +
      Math.max(0, toExactAmount(a.amount) - toExactAmount(a.repaidAmount)),
    0,
  );
  const advanceDeduction = Math.min(outstandingAdvance, netSalary);
  const finalSalary = Math.max(0, netSalary - advanceDeduction);

  // Any unpaid balance from last period's payroll rolls forward
  const previousPeriod = getPreviousPeriod(period);
  const previousPayroll = await Payroll.findOne({
    employeeId,
    period: previousPeriod,
    enabled: true,
  }).session(session);
  const previousPendingAmount = toExactAmount(
    previousPayroll?.pendingAmount || 0,
  );

  return {
    employee,
    basicSalary: fullBasicSalary,
    perDaySalary,
    totalDaysInMonth,
    payableDays,
    unpaidLeaveDays,
    leaveDeduction,
    effectiveDays,
    netSalary,
    advances,
    advanceDeduction,
    finalSalary,
    previousPendingAmount,
    totalPayable: toExactAmount(finalSalary + previousPendingAmount),
  };
};

// @desc    Export payroll records as CSV (same filters as getPayrolls, plus
//          employeeId for a single staff member's full salary history)
// @route   GET /api/hrm/payroll/export/csv
// @access  Private
export const exportPayrollsCSV = async (req, res) => {
  try {
    const { status, period, periodFrom, periodTo, search, employeeId } =
      req.query;
    const query = { enabled: true };

    if (status) query.status = status;
    if (employeeId) query.employeeId = employeeId;
    if (period) {
      query.period = period;
    } else if (periodFrom || periodTo) {
      query.period = {};
      if (periodFrom) query.period.$gte = periodFrom;
      if (periodTo) query.period.$lte = periodTo;
    }
    if (search) {
      const staff = await Staff.find({
        $or: [
          { staffName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      query.employeeId = { $in: staff.map((s) => s._id) };
    }

    const payrolls = await Payroll.find(query)
      .populate("employeeId", "staffName email projectName contactNo")
      .sort({ period: -1, createdAt: -1 });

    const header = [
      "Employee",
      "Period",
      "Basic Salary",
      "Total Allowance",
      "Deductions",
      "Advance Deduction",
      "Net Salary",
      "Paid Amount",
      "Pending Amount",
      "Status",
    ];

    const escapeCsv = (value) => {
      const str = String(value ?? "");
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const rows = payrolls.map((p) =>
      [
        p.employeeId?.staffName || "",
        p.period,
        p.adjustedBasicSalary ?? p.basicSalary,
        p.totalAllowance,
        p.deductions,
        p.advanceDeduction,
        p.netSalary,
        p.paidAmount,
        p.pendingAmount,
        p.status,
      ]
        .map(escapeCsv)
        .join(","),
    );

    const csv = [header.join(","), ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="payroll_export.csv"`,
    );
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to export payroll",
      error: error.message,
    });
  }
};

// @desc    Get all payrolls
// @route   GET /api/payroll
// @access  Private
export const getPayrolls = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 1000,
      status,
      period,
      periodFrom,
      periodTo,
      search,
      employeeId,
    } = req.query;
    const query = { enabled: true };

    if (status) query.status = status;
    if (employeeId) query.employeeId = employeeId;
    // Exact single-period match (kept for backward compatibility) OR a
    // "YYYY-MM" range match — period strings sort lexically the same as
    // chronologically, so a plain $gte/$lte comparison works.
    if (period) {
      query.period = period;
    } else if (periodFrom || periodTo) {
      query.period = {};
      if (periodFrom) query.period.$gte = periodFrom;
      if (periodTo) query.period.$lte = periodTo;
    }

    if (search) {
      const staff = await Staff.find({
        $or: [
          { staffName: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      query.employeeId = { $in: staff.map((s) => s._id) };
    }

    // Non-admin callers (staff self-service, e.g. the "My Payslips" screen)
    // may only ever see their own payroll records — regardless of what
    // employeeId/search they passed — never another staff member's. Staff
    // and User are only linked by email (no stored userId), same pattern
    // used throughout this codebase.
    if (req.user?.role !== "admin") {
      const ownStaff = await Staff.findOne({
        email: req.user?.email?.toLowerCase().trim(),
      }).select("_id");
      // No linked Staff profile → no records, not an error.
      query.employeeId = ownStaff ? ownStaff._id : null;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const payrolls = await Payroll.find(query)
      .populate("employeeId", "staffName email projectName contactNo staffId")
      .sort({ period: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Payroll.countDocuments(query);

    res.status(200).json({
      success: true,
      data: payrolls,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch payrolls",
      error: error.message,
    });
  }
};

// @desc    Get single payroll
// @route   GET /api/payroll/:id
// @access  Private
export const getPayroll = async (req, res) => {
  try {
    const payroll = await Payroll.findById(req.params.id)
      .populate("employeeId", "staffName email projectName staffId")
      .populate("createdBy", "name email");

    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: "Payroll not found",
      });
    }

    res.status(200).json({
      success: true,
      data: payroll,
    });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid payroll ID",
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to fetch payroll",
      error: error.message,
    });
  }
};

// @desc    Preview/calculate a staff member's salary for a period before saving
// @route   GET /api/hrm/payroll/calculate/:employeeId/:period
// @access  Private
export const previewPayroll = async (req, res) => {
  try {
    const { employeeId, period } = req.params;

    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({
        success: false,
        message: "Period must be in YYYY-MM format",
      });
    }

    const salaryData = await calculateSalary(employeeId, period, null);

    res.status(200).json({
      success: true,
      data: {
        basicSalary: toFixedAmount(salaryData.basicSalary),
        perDaySalary: toFixedAmount(salaryData.perDaySalary),
        totalDaysInMonth: salaryData.totalDaysInMonth,
        payableDays: salaryData.payableDays,
        unpaidLeaveDays: salaryData.unpaidLeaveDays,
        leaveDeduction: toFixedAmount(salaryData.leaveDeduction),
        effectiveDays: salaryData.effectiveDays,
        netSalary: toFixedAmount(salaryData.netSalary),
        advanceDeduction: toFixedAmount(salaryData.advanceDeduction),
        finalSalary: toFixedAmount(salaryData.finalSalary),
        previousPendingAmount: toFixedAmount(salaryData.previousPendingAmount),
        totalPayable: toFixedAmount(salaryData.totalPayable),
        employeeName: salaryData.employee.staffName,
      },
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || "Failed to calculate salary",
    });
  }
};

// @desc    Create payroll (supports partial payment — any unpaid balance
//          automatically rolls forward into next month's previousPendingAmount)
// @route   POST /api/payroll
// @access  Private/Admin
export const createPayroll = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      employeeId,
      period,
      allowances = [],
      deductions = 0,
      paymentMethod = "bank",
      bankAccount = "",
      remarks = "",
      paidAmount, // optional — defaults to full amount owed if omitted
      sourceAccountId = null,
    } = req.body;

    // Validate
    if (!employeeId || !period) {
      throw new Error("Employee ID and period are required");
    }

    if (!/^\d{4}-\d{2}$/.test(period)) {
      throw new Error("Period must be in YYYY-MM format");
    }

    // Check existing payroll
    const existing = await Payroll.findOne({ employeeId, period }).session(
      session,
    );
    if (existing) {
      throw new Error("Payroll already exists for this period");
    }

    // Calculate salary (includes leave deduction, advance deduction, and
    // any pending balance carried over from the previous period)
    const salaryData = await calculateSalary(employeeId, period, session);

    // Process allowances/deductions on top of the calculated basic salary
    const processedAllowances = allowances.map((a) => ({
      type: a.type,
      amount: toFixedAmount(a.amount),
    }));
    const totalAllowance = processedAllowances.reduce(
      (sum, a) => sum + a.amount,
      0,
    );
    const deductionAmount = toFixedAmount(deductions);

    const netSalaryExact = Math.max(
      0,
      salaryData.finalSalary + totalAllowance - deductionAmount,
    );
    const totalPayable = toFixedAmount(
      netSalaryExact + salaryData.previousPendingAmount,
    );

    // Partial payment support: paidAmount defaults to the full amount owed,
    // but can be any value from 0 up to totalPayable. Whatever isn't paid
    // becomes pendingAmount and rolls into next month automatically.
    let paidAmountValue =
      paidAmount === undefined || paidAmount === null || paidAmount === ""
        ? totalPayable
        : toFixedAmount(paidAmount);
    paidAmountValue = Math.min(Math.max(0, paidAmountValue), totalPayable);
    const pendingAmount = toFixedAmount(totalPayable - paidAmountValue);

    const status =
      pendingAmount <= 0 ? "paid" : paidAmountValue > 0 ? "partial" : "pending";

    // If a source account is provided, withdraw the amount actually paid
    let sourceAccountData = null;
    if (sourceAccountId && paidAmountValue > 0) {
      const account = await Account.findById(sourceAccountId).session(session);
      if (!account) throw new Error("Source account not found");
      if (account.totalAmount < paidAmountValue) {
        throw new Error(`Insufficient balance in ${account.name}`);
      }
      account.totalAmount = toExactAmount(
        account.totalAmount - paidAmountValue,
      );
      await account.save({ session });
      sourceAccountData = { accountId: account._id, accountName: account.name };
    }

    // Settle outstanding advances against this period's advanceDeduction
    let remainingToSettle = toExactAmount(salaryData.advanceDeduction);
    const usedAdvances = [];
    for (const advance of salaryData.advances) {
      if (remainingToSettle <= 0) break;
      const outstanding = Math.max(
        0,
        toExactAmount(advance.amount) - toExactAmount(advance.repaidAmount),
      );
      if (outstanding <= 0) continue;
      const applied = Math.min(outstanding, remainingToSettle);
      advance.repaidAmount = toExactAmount(
        toExactAmount(advance.repaidAmount) + applied,
      );
      advance.status =
        advance.repaidAmount >= advance.amount ? "repaid" : advance.status;
      await advance.save({ session });
      usedAdvances.push({
        advanceId: advance._id,
        amount: toFixedAmount(applied),
      });
      remainingToSettle = toExactAmount(remainingToSettle - applied);
    }

    const payrollCode = await generatePayrollCode();

    const payroll = new Payroll({
      payrollCode,
      employeeId,
      period,
      basicSalary: toFixedAmount(salaryData.basicSalary),
      adjustedBasicSalary: toFixedAmount(salaryData.finalSalary),
      allowances: processedAllowances,
      totalAllowance: toFixedAmount(totalAllowance),
      deductions: deductionAmount,
      netSalary: toFixedAmount(netSalaryExact),
      netSalaryExact,
      advanceDeduction: toFixedAmount(salaryData.advanceDeduction),
      previousPendingAmount: toFixedAmount(salaryData.previousPendingAmount),
      totalPayable,
      paidAmount: paidAmountValue,
      pendingAmount,
      status,
      paymentMethod,
      sourceAccount: sourceAccountData,
      bankAccount,
      paymentDate: paidAmountValue > 0 ? new Date() : null,
      remarks,
      advances: usedAdvances,
      createdBy: req.user.id,
      attendanceInfo: {
        totalWorkingDays: salaryData.totalDaysInMonth,
        payableDays: salaryData.payableDays,
        unpaidLeaves: salaryData.unpaidLeaveDays,
        perDaySalary: salaryData.perDaySalary,
        effectiveDays: salaryData.effectiveDays,
        leaveDeduction: toFixedAmount(salaryData.leaveDeduction),
        isFull:
          salaryData.unpaidLeaveDays === 0 &&
          salaryData.payableDays === salaryData.totalDaysInMonth,
      },
    });

    await payroll.save({ session });
    await session.commitTransaction();

    const populatedPayroll = await Payroll.findById(payroll._id).populate(
      "employeeId",
      "staffName email projectName",
    );

    res.status(201).json({
      success: true,
      message:
        status === "paid"
          ? "Payroll created and paid in full"
          : `Payroll created — ${pendingAmount.toLocaleString()} remains pending and will carry over to next month`,
      data: populatedPayroll,
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({
      success: false,
      message: "Failed to create payroll",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// @desc    Update payroll — status/remarks, or record an additional payment
//          against the pendingAmount (e.g. paying off a previous partial payroll)
// @route   PUT /api/payroll/:id
// @access  Private/Admin
export const updatePayroll = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      status,
      paymentMethod,
      bankAccount,
      remarks,
      additionalPayment,
      sourceAccountId,
    } = req.body;
    const payroll = await Payroll.findById(req.params.id).session(session);

    if (!payroll) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Payroll not found",
      });
    }

    // Recording a further payment against the outstanding pendingAmount
    if (
      additionalPayment !== undefined &&
      additionalPayment !== null &&
      additionalPayment !== ""
    ) {
      let amount = toFixedAmount(additionalPayment);
      amount = Math.min(Math.max(0, amount), payroll.pendingAmount);

      if (amount > 0) {
        if (sourceAccountId) {
          const account =
            await Account.findById(sourceAccountId).session(session);
          if (!account) throw new Error("Source account not found");
          if (account.totalAmount < amount) {
            throw new Error(`Insufficient balance in ${account.name}`);
          }
          account.totalAmount = toExactAmount(account.totalAmount - amount);
          await account.save({ session });
          payroll.sourceAccount = {
            accountId: account._id,
            accountName: account.name,
          };
        }

        payroll.paidAmount = toFixedAmount(payroll.paidAmount + amount);
        payroll.pendingAmount = toFixedAmount(payroll.pendingAmount - amount);
        payroll.status = payroll.pendingAmount <= 0 ? "paid" : "partial";
        payroll.paymentDate = new Date();
      }
    } else if (status) {
      payroll.status = status;
      if (status === "paid") {
        payroll.pendingAmount = 0;
        payroll.paidAmount = payroll.totalPayable;
        payroll.paymentDate = new Date();
      }
    }

    if (paymentMethod) payroll.paymentMethod = paymentMethod;
    if (bankAccount !== undefined) payroll.bankAccount = bankAccount;
    if (remarks !== undefined) payroll.remarks = remarks;

    await payroll.save({ session });
    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Payroll updated successfully",
      data: payroll,
    });
  } catch (error) {
    await session.abortTransaction();
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid payroll ID",
      });
    }
    res.status(400).json({
      success: false,
      message: "Failed to update payroll",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// @desc    Delete payroll
// @route   DELETE /api/payroll/:id
// @access  Private/Admin
export const deletePayroll = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payroll = await Payroll.findById(req.params.id).session(session);
    if (!payroll) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Payroll not found",
      });
    }

    // Restore the source account balance for whatever was actually paid out
    if (payroll.sourceAccount?.accountId && payroll.paidAmount > 0) {
      const account = await Account.findById(
        payroll.sourceAccount.accountId,
      ).session(session);
      if (account) {
        account.totalAmount = toExactAmount(
          account.totalAmount + payroll.paidAmount,
        );
        await account.save({ session });
      }
    }

    // Reverse any advance repayments this payroll had applied
    for (const used of payroll.advances) {
      const advance = await StaffAdvance.findById(used.advanceId).session(
        session,
      );
      if (advance) {
        advance.repaidAmount = Math.max(
          0,
          toExactAmount(advance.repaidAmount) - toExactAmount(used.amount),
        );
        advance.status = advance.repaidAmount <= 0 ? "pending" : advance.status;
        if (
          advance.status === "repaid" &&
          advance.repaidAmount < advance.amount
        ) {
          advance.status = "approved";
        }
        await advance.save({ session });
      }
    }

    await Payroll.findByIdAndDelete(req.params.id).session(session);

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: "Payroll deleted successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid payroll ID",
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to delete payroll",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};
