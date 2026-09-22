// controllers/teacherController.js
const Student = require("../models/Student");
const Attendance = require("../models/Attendance");
const User = require("../models/User");
const bcrypt = require("bcrypt");
const fs = require("fs");
const path = require("path");
const redisClient = require("../config/redis");


/* ================= HELPERS ================= */

function normalizeWebPath(p) {
  if (!p) return "";
  p = String(p).trim();
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  if (!p.startsWith("/")) return "/" + p;
  return p;
}

function normalizeClassName(c) {
  if (!c && c !== 0) return "";
  return String(c).trim().toUpperCase();
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function buildAttendanceMap(records) {
  const attendanceMap = new Map();

  for (const record of records) {
    if (!record || !record.studentId) continue;
    const studentId = String(record.studentId._id ? record.studentId._id : record.studentId);
    attendanceMap.set(studentId, record);
  }

  return attendanceMap;
}

async function authorizeAttendance(req, res, { className, subject }) {
  if (!req.session?.user?._id) {
    res.status(401).send("Unauthorized: Please log in.");
    return null;
  }

  const teacher = await User.findById(req.session.user._id).lean();
  if (!teacher || teacher.role !== "teacher") {
    res.status(403).send("Forbidden: Teachers only.");
    return null;
  }

  const normalizedClass = normalizeClassName(className);
  const assignedClasses = Array.isArray(teacher.classes)
    ? teacher.classes.map(normalizeClassName).filter(Boolean)
    : [];

  if (!assignedClasses.includes(normalizedClass)) {
    res.status(403).send("Forbidden: This class is not assigned to you.");
    return null;
  }

  const assignedSubject = String(teacher.subject || "").trim();
  const requestedSubject = subject == null ? assignedSubject : String(subject).trim();
  if (!assignedSubject || requestedSubject !== assignedSubject) {
    res.status(403).send("Forbidden: This subject is not assigned to you.");
    return null;
  }

  return { teacher, className: normalizedClass, subject: assignedSubject };
}

/* ================= TEACHER DASHBOARD ================= */
/* ================= TEACHER DASHBOARD ================= */

const getDashboard = async (req, res) => {
  try {
    const success = req.query.successMsg || null;

    /* ---------- USER (SESSION + FRESH) ---------- */
    const sessionUser = req.session.user || {};
    let teacher = sessionUser;

    if (sessionUser._id) {
      const fresh = await User.findById(sessionUser._id).lean();
      if (fresh) {
        fresh.profilePhoto = normalizeWebPath(fresh.profilePhoto);
        teacher = fresh;

        // sync session
        req.session.user.name = fresh.name;
        req.session.user.email = fresh.email;
        req.session.user.subject = fresh.subject;
        req.session.user.classes = fresh.classes;
        req.session.user.profilePhoto = fresh.profilePhoto || null;
      }
    }

    const classes = Array.isArray(teacher.classes)
      ? teacher.classes.map(normalizeClassName).filter(Boolean)
      : [];

    const today = todayStr();
    const selectedDate = (req.query.date || today).trim();
    const selectedClass = normalizeClassName(
      req.query.className || classes[0] || ""
    );
    const authorization = await authorizeAttendance(req, res, {
      className: selectedClass,
      subject: null,
    });
    if (!authorization) return;

    teacher = authorization.teacher;
    const subject = authorization.subject;
    const authorizedClasses = Array.isArray(teacher.classes)
      ? teacher.classes.map(normalizeClassName).filter(Boolean)
      : [];

    /* ---------- BASIC VALIDATIONS (NO REDIS) ---------- */
    if (!subject || classes.length === 0) {
      return res.render("teacherDashboard", {
        user: req.session.user,
        classes,
        subject,
        students: [],
        selectedClass: "",
        selectedDate,
        records: [],
        error: "No subject or classes assigned.",
        success,
      });
    }

    if (!authorizedClasses.includes(selectedClass)) {
      return res.render("teacherDashboard", {
        user: req.session.user,
        classes,
        subject,
        students: [],
        selectedClass,
        selectedDate,
        records: [],
        error: "You are not assigned to this class.",
        success: null,
      });
    }

    if (!isValidDateString(selectedDate) || selectedDate > today) {
      return res.render("teacherDashboard", {
        user: req.session.user,
        classes,
        subject,
        students: [],
        selectedClass,
        selectedDate,
        records: [],
        error: "Future dates are not allowed.",
        success: null,
      });
    }

    /* ---------- 🔑 REDIS KEY (teacher + class + date) ---------- */
    const cacheKey = `teacher:dashboard:${teacher._id}:${selectedClass}:${selectedDate}`;

    /* ---------- REDIS CHECK (READ ONLY) ---------- */
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      console.log("🔥 Teacher Dashboard from REDIS");
      const data = JSON.parse(cached);

      return res.render("teacherDashboard", {
        user: req.session.user, // user NEVER from redis
        classes,
        subject,
        selectedClass,
        selectedDate,
        success,
        error: null,
        ...data, // students + records
      });
    }

    /* ---------- MONGODB (HEAVY PART) ---------- */

    const students = await Student.find({ className: selectedClass }).sort({
      rollNo: 1,
    });

    // Auto-create ABSENT only for TODAY (never cached)
    if (selectedDate === today) {
      const studentIds = students.map((student) => student._id);
      const existingRecords = await Attendance.find({
        studentId: { $in: studentIds },
        className: selectedClass,
        subject,
        date: selectedDate,
      }).select("studentId");

      const existingIds = new Set(
        existingRecords.map((record) => String(record.studentId))
      );

      const missingRecords = students
        .filter((student) => !existingIds.has(String(student._id)))
        .map((student) => ({
          studentId: student._id,
          className: selectedClass,
          subject,
          teacherId: teacher._id,
          date: selectedDate,
          status: "Absent",
        }));

      if (missingRecords.length > 0) {
        await Attendance.insertMany(missingRecords, { ordered: false });
      }
    }

    const records = await Attendance.find({
      className: selectedClass,
      subject,
      date: selectedDate,
    }).populate("studentId");

    const attendanceMap = buildAttendanceMap(records);

    /* ---------- SAVE ONLY DATA TO REDIS ---------- */
    const cachePayload = {
      students,
      records,
    };

    await redisClient.setEx(
      cacheKey,
      60, // 1 minute cache
      JSON.stringify(cachePayload)
    );

    console.log("🗄️ Teacher Dashboard from MONGODB");

    return res.render("teacherDashboard", {
      user: req.session.user,
      classes,
      subject,
      students,
      selectedClass,
      selectedDate,
      records: Array.from(attendanceMap.values()),
      error: null,
      success,
    });
  } catch (err) {
    console.error("❌ getDashboard error:", err);
    return res.redirect("/teacher/dashboard");
  }
};


/* ================= MARK ATTENDANCE ================= */

const markAttendance = async (req, res) => {
  try {
    const io = req.app.get("io");

    let { studentId, className, subject: requestedSubject, date, status, markAll } = req.body;
    className = normalizeClassName(className);
    const today = todayStr();
    date = date || today;

    const authorization = await authorizeAttendance(req, res, {
      className,
      subject: requestedSubject || null,
    });
    if (!authorization) return;

    const { teacher, subject } = authorization;

    if (!isValidDateString(date) || date > today) {
      return res.status(400).send("Invalid or future attendance date.");
    }

    if (!markAll) {
      const student = await Student.findOne({ _id: studentId, className });
      if (!student) {
        return res.status(400).send("Student does not belong to this class.");
      }
    }

    if (markAll === "1") {
      const students = await Student.find({ className });
      for (const s of students) {
        await Attendance.findOneAndUpdate(
          { studentId: s._id, className, subject, date },
          {
            studentId: s._id,
            className,
            subject,
            teacherId: teacher._id,
            date,
            status: "Present",
          },
          { upsert: true }
        );
      }
    } else {
      await Attendance.findOneAndUpdate(
        { studentId, className, subject, date },
        {
          studentId,
          className,
          subject,
          teacherId: teacher._id,
          date,
          status,
        },
        { upsert: true }
      );
    }

    // 🔔 WebSocket notify
    if (io) {
      io.to("admins").emit("attendance:update", {
        teacherName: teacher.name,
        className,
      });
    }

    // ✅ REDIS CACHE INVALIDATION (CORRECT PLACE)
    const cacheKey = `teacher:dashboard:${teacher._id}:${className}:${date}`;
    await redisClient.del(cacheKey);
    await redisClient.del("admin:dashboard");
    console.log("🧹 Attendance-related cache keys cleared:", cacheKey, "admin:dashboard");

    const msg = encodeURIComponent("Attendance updated successfully.");
    return res.redirect(
      `/teacher/dashboard?date=${date}&className=${className}&successMsg=${msg}`
    );
  } catch (err) {
    console.error("❌ markAttendance error:", err);
    return res.redirect("/teacher/dashboard");
  }
};


/* ================= VIEW ATTENDANCE RANGE ================= */

const viewAttendanceRange = async (req, res) => {
  try {
    const teacher = req.session.user;
    const subject = teacher.subject;

    const selectedClass = normalizeClassName(req.query.className || "");
    const { studentId, fromDate, toDate } = req.query;

    if (!fromDate || !toDate) {
      return res.render("attendanceRange", {
        user: req.session.user,
        className: selectedClass,
        subject,
        records: [],
        fromDate: "",
        toDate: "",
        studentName: "",
        error: null,
        dates: [],
      });
    }

    const students = await Student.find({ className: selectedClass }).sort({
      rollNo: 1,
    });

    let records = [];
    let dates = [];

    let cur = new Date(fromDate);
    let end = new Date(toDate);
    while (cur <= end) {
      dates.push(cur.toISOString().split("T")[0]);
      cur.setDate(cur.getDate() + 1);
    }

    const studentIds = students.map((student) => student._id);
    const attendanceRecords = await Attendance.find({
      studentId: { $in: studentIds },
      className: selectedClass,
      subject,
      date: { $gte: fromDate, $lte: toDate },
    });

    const attendanceByStudent = new Map();
    for (const record of attendanceRecords) {
      const studentId = String(record.studentId);
      if (!attendanceByStudent.has(studentId)) {
        attendanceByStudent.set(studentId, new Map());
      }
      attendanceByStudent.get(studentId).set(record.date, record.status);
    }

    for (const student of students) {
      const studentAttendance = attendanceByStudent.get(String(student._id)) || new Map();
      const filled = {};
      dates.forEach((d) => {
        filled[d] = studentAttendance.get(d) || "Absent";
      });

      records.push({ student, attendance: filled });
    }

    return res.render("attendanceRange", {
      user: req.session.user,
      className: selectedClass,
      subject,
      records,
      fromDate,
      toDate,
      studentName: "",
      error: null,
      dates,
    });
  } catch (err) {
    console.error("❌ viewAttendanceRange error:", err);
    return res.redirect("/teacher/dashboard");
  }
};

/* ================= TEACHER PROFILE ================= */

const getProfile = async (req, res) => {
  const teacher = await User.findById(req.session.user._id);
  teacher.profilePhoto = normalizeWebPath(teacher.profilePhoto);
  res.render("teacherProfile", { user: teacher, error: null, success: null });
};

const updateProfile = async (req, res) => {
  try {
    const teacher = await User.findById(req.session.user._id);
    const { name, email, password } = req.body;

    if (name) teacher.name = name;
    if (email) teacher.email = email;
    if (password && password.length >= 8) {
      teacher.password = await bcrypt.hash(password, 10);
    }

    if (req.file) {
      teacher.profilePhoto = "/uploads/" + req.file.filename;
    }

    await teacher.save();
    res.render("teacherProfile", {
      user: teacher,
      error: null,
      success: "Profile updated successfully!",
    });
  } catch (e) {
    res.render("teacherProfile", {
      user: null,
      error: "Error updating profile",
      success: null,
    });
  }
};

/* ================= EXPORT ================= */

module.exports = {
  getDashboard,
  markAttendance,
  viewAttendanceRange,
  getProfile,
  updateProfile,
};
