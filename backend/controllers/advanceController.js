// controllers/advanceController.js
import mongoose from "mongoose";
import Staff from "../models/Staff.js";
import { isAdminRole } from "../config/permissions.js";
import StaffAdvance from "../models/StaffAdvance.js";
import Account from "../models/Account.js";
import { asyncHandler, ApiError } from "../utils/asyncHandler.js";

const toExactAmount = (value) => {
  const num = typeof value === "number" ? value : parseFloat(value);
  return isNaN(num) ? 0 : num;
};

const assertValidId = (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid advance ID");
  }
};

/** GET /api/hrm/advances — list all advances (optional ?status=, ?employeeId=) */
export const getAllAdvances = asyncHandler(async (req, res) => {
  const { status, employeeId } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (employeeId && mongoose.Types.ObjectId.isValid(employeeId)) filter.employeeId = employeeId;
  // Staff logins only ever get their own advances.
  if (!isAdminRole(req.user?.role)) {
    const email = req.user?.email?.toLowerCase().trim();
    const own = email ? await Staff.findOne({ email }).select("_id").lean() : null;
    filter.employeeId = own ? own._id : null;
  }

  const advances = await StaffAdvance.find(filter).sort({ date: -1, createdAt: -1 }).lean();
  res.json({ success: true, count: advances.length, data: advances });
});

/** GET /api/hrm/advances/outstanding/:employeeId — advance balance still owed */
export const getOutstandingAdvance = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(employeeId)) {
    throw new ApiError(400, "Invalid employeeId");
  }
  const advances = await StaffAdvance.find({
    employeeId,
    status: { $in: ["pending", "approved"] },
  })
    .sort({ date: 1, createdAt: 1 })
    .lean();

  const withBalance = advances
    .map((a) => ({
      ...a,
      balance: Math.max(0, toExactAmount(a.amount) - toExactAmount(a.repaidAmount)),
    }))
    .filter((a) => a.balance > 0);
  const totalOutstanding = withBalance.reduce((sum, a) => sum + a.balance, 0);

  res.json({
    success: true,
    data: { employeeId, totalOutstanding, advances: withBalance },
  });
});

/** GET /api/hrm/advances/:id — single advance */
export const getAdvanceById = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const advance = await StaffAdvance.findById(req.params.id).lean();
  if (!advance) throw new ApiError(404, "Advance not found");
  res.json({ success: true, data: advance });
});

/** POST /api/hrm/advances — create an advance */
export const createAdvance = asyncHandler(async (req, res) => {
  const { employeeId, employeeName, amount, date, reason, sourceAccountId } = req.body;

  if (!employeeId || !mongoose.Types.ObjectId.isValid(employeeId)) {
    throw new ApiError(400, "A valid employeeId is required");
  }
  if (!employeeName || !employeeName.trim()) {
    throw new ApiError(400, "employeeName is required");
  }
  if (amount === undefined || Number(amount) <= 0) {
    throw new ApiError(400, "A positive amount is required");
  }
  if (!date) {
    throw new ApiError(400, "date is required");
  }

  let sourceAccount;
  if (sourceAccountId) {
    if (!mongoose.Types.ObjectId.isValid(sourceAccountId)) {
      throw new ApiError(400, "Invalid sourceAccountId");
    }
    const account = await Account.findById(sourceAccountId);
    if (!account) throw new ApiError(404, "Source account not found");
    if (account.totalAmount < Number(amount)) {
      throw new ApiError(400, `Insufficient balance in ${account.name}`);
    }
    account.totalAmount = toExactAmount(account.totalAmount - Number(amount));
    await account.save();
    sourceAccount = { accountId: account._id, accountName: account.name };
  }

  const advance = await StaffAdvance.create({
    employeeId,
    employeeName: employeeName.trim(),
    amount: Number(amount),
    sourceAccount,
    date: new Date(date),
    reason: reason?.trim() || "",
    status: "pending",
  });

  res.status(201).json({ success: true, message: "Advance created successfully", data: advance });
});

/** PUT /api/hrm/advances/:id — update an advance */
export const updateAdvance = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const { employeeId, employeeName, amount, date, reason } = req.body;

  if (employeeId && !mongoose.Types.ObjectId.isValid(employeeId)) {
    throw new ApiError(400, "Invalid employeeId");
  }
  if (amount !== undefined && Number(amount) <= 0) {
    throw new ApiError(400, "amount must be a positive number");
  }

  const existing = await StaffAdvance.findById(req.params.id);
  if (!existing) throw new ApiError(404, "Advance not found");

  // If the amount changed, keep the source account balance in sync
  if (amount !== undefined) {
    const newAmount = Number(amount);

    if (newAmount < toExactAmount(existing.repaidAmount)) {
      throw new ApiError(
        400,
        `Amount cannot be less than the already repaid amount (${existing.repaidAmount})`,
      );
    }

    const diff = toExactAmount(newAmount - existing.amount);
    if (diff !== 0 && existing.sourceAccount?.accountId) {
      const account = await Account.findById(existing.sourceAccount.accountId);
      if (account) {
        if (diff > 0 && account.totalAmount < diff) {
          throw new ApiError(400, `Insufficient balance in ${account.name}`);
        }
        account.totalAmount = toExactAmount(account.totalAmount - diff);
        await account.save();
      }
    }
  }

  const updated = await StaffAdvance.findByIdAndUpdate(
    req.params.id,
    {
      ...(employeeId !== undefined && { employeeId }),
      ...(employeeName !== undefined && { employeeName: employeeName.trim() }),
      ...(amount !== undefined && { amount: Number(amount) }),
      ...(date !== undefined && { date: new Date(date) }),
      ...(reason !== undefined && { reason: reason.trim() }),
    },
    { new: true, runValidators: true, context: "query" },
  );

  res.json({ success: true, message: "Advance updated successfully", data: updated });
});

/** PUT /api/hrm/advances/:id/status — approve / reject / mark repaid */
export const updateAdvanceStatus = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const { status } = req.body;
  const allowed = ["pending", "approved", "rejected", "repaid"];
  if (!allowed.includes(status)) {
    throw new ApiError(400, `status must be one of: ${allowed.join(", ")}`);
  }

  const advance = await StaffAdvance.findById(req.params.id);
  if (!advance) throw new ApiError(404, "Advance not found");

  const update = { status };
  // Marking as repaid settles the full amount, so the outstanding balance
  // (amount - repaidAmount) comes out to zero.
  if (status === "repaid") {
    update.repaidAmount = advance.amount;
  }

  const updated = await StaffAdvance.findByIdAndUpdate(req.params.id, update, { new: true });
  res.json({ success: true, message: `Advance marked as ${status}`, data: updated });
});

/** POST /api/hrm/advances/:id/repay — record a (partial) repayment */
export const recordRepayment = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const { amount } = req.body;
  if (amount === undefined || Number(amount) <= 0) {
    throw new ApiError(400, "A positive repayment amount is required");
  }

  const advance = await StaffAdvance.findById(req.params.id);
  if (!advance) throw new ApiError(404, "Advance not found");

  const newRepaidAmount = Number(advance.repaidAmount || 0) + Number(amount);
  advance.repaidAmount = Math.min(newRepaidAmount, advance.amount);
  if (advance.repaidAmount >= advance.amount) {
    advance.status = "repaid";
  }
  await advance.save();

  res.json({ success: true, message: "Repayment recorded successfully", data: advance });
});

/** DELETE /api/hrm/advances/:id — remove an advance */
export const deleteAdvance = asyncHandler(async (req, res) => {
  assertValidId(req.params.id);
  const advance = await StaffAdvance.findById(req.params.id);
  if (!advance) throw new ApiError(404, "Advance not found");

  if (advance.sourceAccount?.accountId) {
    const account = await Account.findById(advance.sourceAccount.accountId);
    if (account) {
      account.totalAmount = toExactAmount(account.totalAmount + advance.amount);
      await account.save();
    }
  }

  await advance.deleteOne();
  res.json({ success: true, message: "Advance deleted successfully" });
});

/** DELETE /api/hrm/advances — bulk delete { ids: [...] } */
export const deleteManyAdvances = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(400, "ids must be a non-empty array");
  }
  const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
  const advances = await StaffAdvance.find({ _id: { $in: validIds } });

  // Refund each advance back to its source account (same as single delete)
  for (const adv of advances) {
    if (adv.sourceAccount?.accountId) {
      await Account.findByIdAndUpdate(adv.sourceAccount.accountId, {
        $inc: { totalAmount: adv.amount },
      });
    }
  }

  const result = await StaffAdvance.deleteMany({ _id: { $in: advances.map((a) => a._id) } });
  res.json({
    success: true,
    message: `${result.deletedCount} advance(s) deleted successfully`,
    deletedCount: result.deletedCount,
  });
});