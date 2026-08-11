import Expense from "../models/Expense.js";
import Payroll from "../models/Payroll.js";

// @desc    Get all expenses
// @route   GET /api/expenses
// @access  Private
export const getExpenses = async (req, res) => {
  try {
    const { page = 1, limit = 10, isPayroll, startDate, endDate } = req.query;
    const query = {};

    if (isPayroll !== undefined) {
      query.isPayroll = isPayroll === "true";
    }

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const expenses = await Expense.find(query)
      .populate("employeeId", "staffName")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Expense.countDocuments(query);

    // Calculate totals
    const totals = await Expense.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: "$finalAmount" } } },
    ]);

    res.status(200).json({
      success: true,
      data: expenses,
      summary: {
        totalExpenses: totals[0]?.total || 0,
        count: total,
      },
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
      message: "Failed to fetch expenses",
      error: error.message,
    });
  }
};

// @desc    Get single expense
// @route   GET /api/expenses/:id
// @access  Private
export const getExpense = async (req, res) => {
  try {
    const expense = await Expense.findById(req.params.id)
      .populate("employeeId", "staffName")
      .populate("createdBy", "name email")
      .populate("payrollId", "payrollCode period");

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: "Expense not found",
      });
    }

    res.status(200).json({
      success: true,
      data: expense,
    });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(400).json({
        success: false,
        message: "Invalid expense ID",
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to fetch expense",
      error: error.message,
    });
  }
};

// @desc    Get payroll expenses
// @route   GET /api/expenses/payroll/:payrollId
// @access  Private
export const getPayrollExpenses = async (req, res) => {
  try {
    const { payrollId } = req.params;
    const expenses = await Expense.find({ payrollId })
      .populate("employeeId", "staffName")
      .populate("createdBy", "name email");

    const total = expenses.reduce((sum, e) => sum + e.finalAmount, 0);

    res.status(200).json({
      success: true,
      data: expenses,
      summary: {
        totalExpenses: total,
        count: expenses.length,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch payroll expenses",
      error: error.message,
    });
  }
};

// @desc    Get expense summary
// @route   GET /api/expenses/summary
// @access  Private
export const getExpenseSummary = async (req, res) => {
  try {
    const { period } = req.query;
    const match = {};

    if (period) {
      match.period = period;
    }

    const summary = await Expense.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$categoryType",
          total: { $sum: "$finalAmount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]);

    const totalExpenses = summary.reduce((sum, s) => sum + s.total, 0);

    res.status(200).json({
      success: true,
      data: summary,
      total: totalExpenses,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get expense summary",
      error: error.message,
    });
  }
};