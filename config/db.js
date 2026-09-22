const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const mongoURI =
      process.env.MONGO_URI || "mongodb+srv://username:password@cluster.mongodb.net/attendanceDB?retryWrites=true&w=majority";

    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 5000, // Try for 5 seconds then fail
    });

    console.log("✓ MongoDB Atlas Connected Successfully");
  } catch (err) {
    throw new Error("MongoDB connection failed during startup");
  }
};

module.exports = connectDB;
