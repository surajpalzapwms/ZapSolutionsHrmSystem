import mongoose from "mongoose";

// `beforeIndexes` runs after connecting and BEFORE indexes are synced: it
// gives records saved by the single-company version to a
// company (see services/companyMigration.js).
const connectDB = async (uri, beforeIndexes) => {
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    // Never print the connection string: it contains the database password.
    console.log(`✅ MongoDB connected successfully (${mongoose.connection.host})`);

    if (beforeIndexes) await beforeIndexes();

    // Mongoose never drops an index just because the field was removed
    // or renamed in the schema — the old index stays in MongoDB forever
    // until something explicitly drops it. syncIndexes() reconciles each
    // collection's real indexes with what the current schema declares:
    // the old single-company unique indexes (e.g. a unique staffId) are
    // replaced by per-company ones (e.g. { company, staffId }, see the
    // index rewrite in utils/tenant.js), so two companies can both have
    // staff "EMP001".
    for (const model of Object.values(mongoose.models)) {
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
