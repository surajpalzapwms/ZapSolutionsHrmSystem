// src/components/payroll/PayrollSummary.jsx
import React from "react";
import { Wallet, Clock, CheckCircle, Users } from "lucide-react";
import Card from "../common/Card";
import { formatCurrency } from "../../utils/numberUtils";

const PayrollSummary = ({ summary }) => {
  const cards = [
    { label: "Total Records", value: summary.count, icon: Users, color: "text-blue-600 bg-blue-50" },
    { label: "Total Net Pay", value: formatCurrency(summary.totalNet), icon: Wallet, color: "text-indigo-600 bg-indigo-50" },
    {
      label: "Pending",
      // The pending summary loads separately from the list — show a
      // placeholder instead of a misleading ₹0 while it's on its way.
      value:
        summary.pendingLoading && !summary.pending
          ? "Loading…"
          : formatCurrency(summary.pending),
      icon: Clock,
      color: "text-yellow-600 bg-yellow-50",
    },
    { label: "Paid", value: summary.paid, icon: CheckCircle, color: "text-green-600 bg-green-50" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {cards.map((c) => (
        <Card key={c.label} noPadding className="p-4">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-full ${c.color}`}>
              <c.icon size={20} />
            </div>
            <div>
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className="text-lg font-bold text-gray-800">{c.value}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};

export default PayrollSummary;