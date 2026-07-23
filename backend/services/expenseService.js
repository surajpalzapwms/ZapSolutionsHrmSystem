import Expense from "../models/Expense.js";

export class ExpenseService {
  static async getExpenseAnalytics(startDate, endDate) {
    const match = {};
    if (startDate) match.date = { $gte: new Date(startDate) };
    if (endDate) match.date = { $lte: new Date(endDate) };

    const analytics = await Expense.aggregate([
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

    const totalExpenses = analytics.reduce((sum, a) => sum + a.total, 0);

    return {
      categories: analytics,
      totalExpenses,
      count: analytics.reduce((sum, a) => sum + a.count, 0),
    };
  }

  static async getPayrollExpensesSummary(payrollId) {
    const expenses = await Expense.find({ payrollId });
    const total = expenses.reduce((sum, e) => sum + e.finalAmount, 0);

    return {
      expenses,
      total,
      count: expenses.length,
    };
  }
}