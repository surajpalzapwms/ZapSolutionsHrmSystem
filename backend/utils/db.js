import mongoose from "mongoose";
import Staff from "../models/Staff.js";
import User from "../models/User.js";
import Holiday from "../models/holiday.js";
import Attendance from "../models/Attendance.js";
import Expense from "../models/Expense.js";
import Leave from "../models/Leave.js";
import Payroll from "../models/Payroll.js";
import StaffAdvance from "../models/StaffAdvance.js";
import StaffBasicPayroll from "../models/StaffBasicPayroll.js";
import Account from "../models/Account.js";

const connectDB = async (uri) => {
  try {
    console.log('value of uri:', uri);
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("✅ MongoDB connected successfully");

    // Mongoose never drops an index just because the field was removed
    // or renamed in the schema — the old index stays in MongoDB forever
    // until something explicitly drops it. syncIndexes() reconciles each
    // collection's real indexes with what the current schema declares,
    // which is what clears out stale indexes like a leftover unique
    // "MRId" index from an earlier version of the Staff model.
    const models = [
      Staff,
      User,
      Holiday,
      Attendance,
      Expense,
      Leave,
      Payroll,
      StaffAdvance,
      StaffBasicPayroll,
      Account,
    ];
    for (const model of models) {
      try {
        await model.syncIndexes();
      } catch (syncErr) {
        console.warn(`⚠️ Index sync failed for ${model.modelName}:`, syncErr.message);
      }
    }
    console.log("✅ Indexes synced with current schemas");

    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB connection error:", err);
    });
    
    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️ MongoDB disconnected");
    });
    
    return mongoose.connection;
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    throw error;
  }
};

export default connectDB;