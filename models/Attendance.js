// models/Attendance.js
const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
  },
  className: {
    type: String,
    required: true,
  },
  // ✅ NEW: kis subject ki attendance hai
  subject: {
    type: String,
    required: true,
  },
  // ✅ OPTIONAL: kis teacher ne mark kiya
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  date: {
    type: String, // "YYYY-MM-DD"
    required: true,
  },
  status: {
    type: String,
    enum: ["Present", "Absent"],
    required: true,
  },
});

attendanceSchema.index({ studentId: 1, className: 1, subject: 1, date: 1 }, { unique: true });
attendanceSchema.index({ className: 1, subject: 1, date: 1, studentId: 1 });

module.exports = mongoose.model("Attendance", attendanceSchema);
