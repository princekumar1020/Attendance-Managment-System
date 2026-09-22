
const fs = require("fs");
const path = require("path");
const Student = require("../models/Student");
const User = require("../models/User");
const Attendance = require("../models/Attendance");
const validClasses = require("../utils/validClasses");
const bcrypt = require("bcrypt");
const redisClient = require("../config/redis");


// -------------------- DASHBOARD --------------------

// -------------------- DASHBOARD --------------------
const getDashboard = async (req, res) => {
  try {
    // 🔑 Redis cache key
    const cacheKey = "admin:dashboard";

    // ================= REDIS CHECK =================
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      console.log("🔥 Dashboard loaded from REDIS");
      return res.render("adminDashboard", JSON.parse(cachedData));
    }

    // ================= STATS (MongoDB) =================
    const totalStudents = await Student.countDocuments();
    const totalTeachers = await User.countDocuments({ role: "teacher" });

    const totalAttendance = await Attendance.countDocuments();
    const presentCount = await Attendance.countDocuments({ status: "Present" });

    const attendancePercent =
      totalAttendance === 0
        ? 0
        : Math.round((presentCount / totalAttendance) * 100);

    // ================= FRESH USER =================
    let freshUser = null;
    if (req.session?.user?._id) {
      freshUser = await User.findById(req.session.user._id).lean();
    }
    const userToSend = freshUser || req.session?.user || null;

    // ================= TEACHERS MAP (WebSocket fix safe) =================
    const teachers = await User.find(
      { role: "teacher" },
      "_id name subject"
    ).lean();

    const teachersMap = {};
    teachers.forEach((t) => {
      teachersMap[t._id.toString()] = {
        name: t.name,
        subject: t.subject || "Faculty Member",
      };
    });

    // ================= FINAL RESPONSE DATA =================
    const responseData = {
      error: null,
      success: null,
      stats: {
        totalStudents,
        totalTeachers,
        attendancePercent,
      },
      user: userToSend,
      teachersMap,
    };

    // ================= SAVE TO REDIS (TTL = 60 sec) =================
    await redisClient.setEx(
      cacheKey,
      60, // 1 minute cache
      JSON.stringify(responseData)
    );

    console.log("🗄️ Dashboard loaded from MONGODB");
    res.render("adminDashboard", responseData);

  } catch (err) {
    console.error("❌ Dashboard Error:", err);
    res.render("adminDashboard", {
      error: "Error loading dashboard.",
      success: null,
      stats: null,
      teachersMap: {},
      user: req.session?.user || null,
    });
  }
};



// -------------------- STUDENTS --------------------
const viewStudents = async (req, res) => {
  try {
    const students = await Student.find();
    res.render("students", { students, error: null, success: null });
  } catch (err) {
    console.error(err);
    res.render("students", {
      students: [],
      error: "❌ Error fetching students",
      success: null,
    });
  }
};

/**
 * addStudent:
 *  - Single mode  : name, rollNo, className
 *  - Bulk mode    : bulkData textarea (each line: Name,RollNo,Class)
 */
const addStudent = async (req, res) => {
  try {
    const { name, rollNo, className, bulkData } = req.body;

    // ---------- BULK MODE ----------
    if (bulkData && bulkData.trim().length > 0) {
      const lines = bulkData.split("\n");
      let successCount = 0;
      let errorLines = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(",").map((p) => p.trim());
        if (parts.length !== 3) {
          errorLines.push(
            `Line ${i + 1}: Invalid format (use Name,RollNo,ClassName)`
          );
          continue;
        }

        const [lineName, lineRollNo, lineClassNameRaw] = parts;
        const lineClassName = lineClassNameRaw.toUpperCase();

        if (isNaN(lineRollNo)) {
          errorLines.push(`Line ${i + 1}: Roll No must be numeric!`);
          continue;
        }

        if (!validClasses.includes(lineClassName)) {
          errorLines.push(
            `Line ${i + 1}: Invalid class (${lineClassName}). Use 1A–12D`
          );
          continue;
        }

        const existingStudent = await Student.findOne({
          rollNo: lineRollNo,
          className: lineClassName,
        });
        if (existingStudent) {
          errorLines.push(
            `Line ${i + 1}: Roll No already exists in class ${lineClassName}.`
          );
          continue;
        }

        const student = new Student({
          name: lineName,
          rollNo: lineRollNo,
          className: lineClassName,
        });
        await student.save();
        successCount++;
      }

      const students = await Student.find();

      const successMsg =
        successCount > 0
          ? `✅ ${successCount} student(s) added successfully!`
          : null;

      const errorMsg = errorLines.length > 0 ? errorLines.join(" | ") : null;

      return res.render("students", {
        students,
        error: errorMsg,
        success: successMsg,
      });
    }

    // ---------- SINGLE MODE ----------
    if (isNaN(rollNo)) {
      return res.render("students", {
        students: await Student.find(),
        error: "❌ Roll No must be numeric!",
        success: null,
      });
    }

    const classNameUpper = className.toUpperCase();

    if (!validClasses.includes(classNameUpper)) {
      return res.render("students", {
        students: await Student.find(),
        error: "❌ Invalid class! (Choose 1A–12D)",
        success: null,
      });
    }

    const existingStudent = await Student.findOne({
      rollNo,
      className: classNameUpper,
    });
    if (existingStudent) {
      return res.render("students", {
        students: await Student.find(),
        error: "❌ Roll No already exists in this class.",
        success: null,
      });
    }

    const student = new Student({ name, rollNo, className: classNameUpper });
    await student.save();

    res.render("students", {
      students: await Student.find(),
      error: null,
      success: "✅ Student added successfully!",
    });
  } catch (err) {
    console.error(err);
    res.render("students", {
      students: [],
      error: "❌ Error adding student",
      success: null,
    });
  }
};

const updateStudent = async (req, res) => {
  try {
    const { studentId, newRollNo, newName, newClassName } = req.body;
    const student = await Student.findById(studentId);

    if (!student) {
      return res.render("students", {
        students: await Student.find(),
        error: "❌ Student not found.",
        success: null,
      });
    }

    if (newRollNo && isNaN(newRollNo)) {
      return res.render("students", {
        students: await Student.find(),
        error: "❌ Roll No must be numeric!",
        success: null,
      });
    }

    let newClassNameUpper = newClassName ? newClassName.toUpperCase() : null;

    if (newClassNameUpper && !validClasses.includes(newClassNameUpper)) {
      return res.render("students", {
        students: await Student.find(),
        error: "❌ Invalid class! (Choose 1A–12D)",
        success: null,
      });
    }

    if (
      newRollNo &&
      newClassNameUpper &&
      (newRollNo !== student.rollNo ||
        newClassNameUpper !== student.className)
    ) {
      const existingStudent = await Student.findOne({
        rollNo: newRollNo,
        className: newClassNameUpper,
        _id: { $ne: studentId },
      });
      if (existingStudent) {
        return res.render("students", {
          students: await Student.find(),
          error: "❌ Roll No already exists in that class.",
          success: null,
        });
      }
    }

    if (newName) student.name = newName;
    if (newRollNo) student.rollNo = newRollNo;
    if (newClassNameUpper) student.className = newClassNameUpper;

    await student.save();

    res.render("students", {
      students: await Student.find(),
      error: null,
      success: "✅ Student updated successfully!",
    });
  } catch (err) {
    console.error(err);
    res.render("students", {
      students: [],
      error: "❌ Error updating student",
      success: null,
    });
  }
};

const deleteStudent = async (req, res) => {
  try {
    const { studentId } = req.body;
    await Student.findByIdAndDelete(studentId);

    res.render("students", {
      students: await Student.find(),
      error: null,
      success: "✅ Student deleted successfully!",
    });
  } catch (err) {
    console.error(err);
    res.render("students", {
      students: [],
      error: "❌ Error deleting student",
      success: null,
    });
  }
};

// -------------------- STUDENTS CSV DOWNLOAD --------------------
const downloadStudentsCSV = async (req, res) => {
  try {
    const students = await Student.find().sort({ className: 1, rollNo: 1 });

    // Header row
    let csv = "RollNo,Name,Class\n";

    students.forEach((s) => {
      const roll = s.rollNo !== undefined ? s.rollNo : "";
      const name = s.name ? String(s.name) : "";
      const safeName = `"${name.replace(/"/g, '""')}"`;
      const cls = s.className ? s.className : "";

      csv += `${roll},${safeName},${cls}\n`;
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=students.csv");
    return res.send(csv);
  } catch (err) {
    console.error("❌ Error generating students CSV:", err);
    return res
      .status(500)
      .send("Error generating CSV. Please try again later.");
  }
};

// -------------------- TEACHERS --------------------
const viewTeachers = async (req, res) => {
  try {
    const teachers = await User.find({ role: "teacher" });
    res.render("teachers", { teachers, error: null, success: null });
  } catch (err) {
    console.error(err);
    res.render("teachers", {
      teachers: [],
      error: "❌ Error fetching teachers",
      success: null,
    });
  }
};

const addTeacher = async (req, res) => {
  try {
    const { name, email, password, subject, classesInput } = req.body;

    const teacherList = await User.find({ role: "teacher" });

    if (!password || password.length < 8) {
      return res.render("teachers", {
        teachers: teacherList,
        error: "❌ Password must be at least 8 characters!",
        success: null,
      });
    }

    const existingTeacherEmail = await User.findOne({ email });
    if (existingTeacherEmail) {
      return res.render("teachers", {
        teachers: teacherList,
        error: "❌ Email already registered!",
        success: null,
      });
    }

    if (!subject || !subject.trim()) {
      return res.render("teachers", {
        teachers: teacherList,
        error: "❌ Subject is required for a teacher.",
        success: null,
      });
    }

    if (!classesInput || !classesInput.trim()) {
      return res.render("teachers", {
        teachers: teacherList,
        error:
          "❌ Please enter at least one class for the teacher (comma separated).",
        success: null,
      });
    }

    let classes = classesInput
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter((c) => c);
      // 🔒 SUBJECT + CLASS DUPLICATE CHECK
for (let c of classes) {
  const conflict = await User.findOne({
    role: "teacher",
    subject: subject.trim(),
    classes: c,
  });

  if (conflict) {
    return res.render("teachers", {
      teachers: teacherList,
      error: `❌ ${subject} is already assigned for class ${c} to ${conflict.name}`,
      success: null,
    });
  }
}


    if (classes.length === 0) {
      return res.render("teachers", {
        teachers: teacherList,
        error: "❌ Please enter at least one valid class for the teacher.",
        success: null,
      });
    }

    for (let c of classes) {
      if (!validClasses.includes(c)) {
        return res.render("teachers", {
          teachers: teacherList,
          error: `❌ Invalid class: ${c}. Use 1A–12D format.`,
          success: null,
        });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const teacher = new User({
      name,
      email,
      password: hashedPassword,
      role: "teacher",
      subject: subject.trim(),
      classes,
    });

    await teacher.save();
    const updatedTeachers = await User.find({ role: "teacher" });

    res.render("teachers", {
      teachers: updatedTeachers,
      error: null,
      success: "✅ Teacher added successfully!",
    });
  } catch (err) {
    console.error(err);
    res.render("teachers", {
      teachers: [],
      error: "❌ Error adding teacher",
      success: null,
    });
  }
};

const updateTeacher = async (req, res) => {
  try {
    const {
      teacherId,
      newName,
      newEmail,
      newPassword,
      newSubject,
      newClassesInput,
    } = req.body;

    const teacher = await User.findOne({ _id: teacherId, role: "teacher" });

    const teacherList = await User.find({ role: "teacher" });

    if (!teacher) {
      return res.render("teachers", {
        teachers: teacherList,
        error: "❌ Teacher not found.",
        success: null,
      });
    }

    if (newEmail && newEmail !== teacher.email) {
      const existingTeacher = await User.findOne({ email: newEmail });
      if (existingTeacher) {
        return res.render("teachers", {
          teachers: teacherList,
          error: "❌ Email already in use!",
          success: null,
        });
      }
    }

    if (newPassword && newPassword.length < 8) {
      return res.render("teachers", {
        teachers: teacherList,
        error: "❌ Password must be at least 8 characters!",
        success: null,
      });
    }

    let updatedClasses = null;
    const updatedSubject =
      newSubject && newSubject.trim() ? newSubject.trim() : teacher.subject;
    if (newClassesInput && newClassesInput.trim()) {
      updatedClasses = newClassesInput
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter((c) => c);

      if (updatedClasses.length === 0) {
        return res.render("teachers", {
          teachers: teacherList,
          error:
            "❌ Please enter at least one valid class when updating classes.",
          success: null,
        });
      }

      for (let c of updatedClasses) {
        if (!validClasses.includes(c)) {
          return res.render("teachers", {
            teachers: teacherList,
            error: `❌ Invalid class: ${c}. Use 1A–12D format.`,
            success: null,
          });
        }
      }
    }

    const classesToCheck = updatedClasses || teacher.classes || [];
    for (const className of classesToCheck) {
      const conflict = await User.findOne({
        _id: { $ne: teacher._id },
        role: "teacher",
        subject: updatedSubject,
        classes: className,
      });

      if (conflict) {
        return res.render("teachers", {
          teachers: teacherList,
          error: `❌ ${updatedSubject} is already assigned for class ${className} to ${conflict.name}`,
          success: null,
        });
      }
    }

    if (newName) teacher.name = newName;
    if (newEmail) teacher.email = newEmail;
    if (newSubject && newSubject.trim()) teacher.subject = updatedSubject;

    if (newPassword) {
      teacher.password = await bcrypt.hash(newPassword, 10);
    }

    if (updatedClasses) {
      teacher.classes = updatedClasses;
    }

    await teacher.save();

    const updatedTeachers = await User.find({ role: "teacher" });

    res.render("teachers", {
      teachers: updatedTeachers,
      error: null,
      success: "✅ Teacher updated successfully!",
    });
  } catch (err) {
    console.error(err);
    res.render("teachers", {
      teachers: [],
      error: "❌ Error updating teacher",
      success: null,
    });
  }
};

const deleteTeacher = async (req, res) => {
  try {
    const { teacherId } = req.body;
    await User.deleteOne({ _id: teacherId, role: "teacher" });

    res.render("teachers", {
      teachers: await User.find({ role: "teacher" }),
      error: null,
      success: "✅ Teacher deleted successfully!",
    });
  } catch (err) {
    console.error(err);
    res.render("teachers", {
      teachers: [],
      error: "❌ Error deleting teacher",
      success: null,
    });
  }
};

// -------------------- REPORTS --------------------
const getReports = (req, res) => {
  res.render("reports", { error: null, success: null });
};

function buildStudentAttendanceMap(records) {
  const map = new Map();

  for (const record of records) {
    if (!record || !record.studentId) continue;
    const studentId = String(record.studentId);
    if (!map.has(studentId)) {
      map.set(studentId, {});
    }

    const statusMap = map.get(studentId);
    if (!statusMap[record.date] || (statusMap[record.date] === "Absent" && record.status === "Present")) {
      statusMap[record.date] = record.status;
    }
  }

  return map;
}

/**
 * 🎯 Student-wise Report (calendar + all-subject view)
 * req.body: rollNo, className, fromDate, toDate, [subject]
 *
 * - Agar subject diya → calendar view (per date Present/Absent)
 * - Agar subject blank → subject-wise % table + bar graph
 */

// 🎯 Student-wise Report (with optional subject & two modes)
// 🎯 Student-wise Report (with optional subject & two modes)

// 🎯 Student-wise Report (MONTH calendar + all subjects)

// 🎯 Student-wise Report (FIXED for multi-month calendar)
// 🎯 Student-wise Report (UPDATED)
const studentReport = async (req, res) => {
  try {
    const { rollNo, className, fromDate, toDate, subject } = req.body;
    const classNameUpper = className.toUpperCase();
    const subjectTrim = subject && subject.trim() ? subject.trim() : "";
    const mode = subjectTrim ? "subject" : "all";

    const student = await Student.findOne({
      rollNo,
      className: classNameUpper,
    });

    if (!student) {
      return res.render("studentReport", {
        student: null,
        fromDate,
        toDate,
        subject: subjectTrim,
        mode,
        calendar: {},
        subjectStats: [],
        error: "Student not found",
      });
    }

    let calendar = {};
    let subjectStats = [];

    /* ================= SUBJECT MODE ================= */
    if (mode === "subject") {
      const records = await Attendance.find({
        studentId: student._id,
        className: classNameUpper,
        subject: subjectTrim,
        date: { $gte: fromDate, $lte: toDate },
      });

      // 🔑 DATE → STATUS MAP (NO MONTH LOGIC HERE)
      records.forEach((r) => {
        if (!calendar[r.date]) {
          calendar[r.date] = r.status;
        } else if (calendar[r.date] === "Absent" && r.status === "Present") {
          calendar[r.date] = "Present";
        }
      });
    }

    /* ================= ALL SUBJECTS MODE ================= */
    if (mode === "all") {
      const records = await Attendance.find({
        studentId: student._id,
        className: classNameUpper,
        date: { $gte: fromDate, $lte: toDate },
      });

      const map = {};
      records.forEach((r) => {
        const s = r.subject;
        if (!map[s]) map[s] = { total: 0, present: 0 };
        map[s].total++;
        if (r.status === "Present") map[s].present++;
      });

      subjectStats = Object.keys(map).map((s) => ({
        subject: s,
        totalLectures: map[s].total,
        presentCount: map[s].present,
        percent: (map[s].present / map[s].total) * 100,
      }));
    }

    res.render("studentReport", {
      student,
      fromDate,
      toDate,
      subject: subjectTrim,
      mode,
      calendar,      // ✅ FULL RANGE DATA
      subjectStats,  // ✅ OLD FEATURE SAFE
      error: null,
    });

  } catch (err) {
    console.error(err);
    res.render("studentReport", {
      student: null,
      fromDate: "",
      toDate: "",
      subject: "",
      mode: "all",
      calendar: {},
      subjectStats: [],
      error: "Error loading report",
    });
  }
};


/**
 * 🎯 Date-wise + Class-wise (single date)
 * Form 1: only date, [subject]  -> all classes, all students
 * Form 2: className + date, [subject] -> single class for that date
 */
const dateReport = async (req, res) => {
  try {
    const { date, className, subject } = req.body;
    const subjectTrim = subject && subject.trim() ? subject.trim() : null;

    let studentFilter = {};
    let classNameUpper = "";

    if (className && className.trim()) {
      classNameUpper = className.toUpperCase();
      studentFilter.className = classNameUpper;
    }

    const students = await Student.find(studentFilter);
    const studentIds = students.map((student) => student._id);
    let query = { studentId: { $in: studentIds }, date };
    if (subjectTrim) {
      query.subject = subjectTrim;
    }

    const recs = await Attendance.find(query);
    const attendanceByStudent = new Map();

    for (const record of recs) {
      const studentId = String(record.studentId);
      if (!attendanceByStudent.has(studentId)) {
        attendanceByStudent.set(studentId, "Absent");
      }

      if (record.status === "Present") {
        attendanceByStudent.set(studentId, "Present");
      }
    }

    const records = students.map((student) => ({
      student,
      attendance: { [date]: attendanceByStudent.get(String(student._id)) || "Absent" },
    }));

    let typeLabel = `Date Report (${date}`;
    if (classNameUpper) typeLabel += `, Class: ${classNameUpper}`;
    if (subjectTrim) typeLabel += `, Subject: ${subjectTrim}`;
    typeLabel += ")";

    res.render("reportResult", {
      type: typeLabel,
      records,
      error: records.length === 0 ? "No records found." : null,
      dates: [date],
    });
  } catch (err) {
    console.error(err);
    res.render("reportResult", {
      type: "Date Report",
      records: [],
      error: "❌ Error fetching date report",
      dates: [],
    });
  }
};

const classSubjectsReport = async (req, res) => {
  try {
    const { className, fromDate, toDate } = req.body;
    const classNameUpper = className.toUpperCase();

    if (!validClasses.includes(classNameUpper)) {
      return res.render("reportResult", {
        type: "Class – All Subjects Report",
        records: [],
        error: `❌ Invalid class ${classNameUpper}. Use 1A–12D format.`,
        dates: [],
      });
    }

    const students = await Student.find({ className: classNameUpper });

    if (!students || students.length === 0) {
      return res.render("reportResult", {
        type: `Class – All Subjects Report (Class: ${classNameUpper})`,
        records: [],
        error: "❌ No students found for this class.",
        dates: [],
      });
    }

    const teachers = await User.find({
      role: "teacher",
      classes: classNameUpper,
    });

    if (!teachers || teachers.length === 0) {
      return res.render("reportResult", {
        type: `Class – All Subjects Report (Class: ${classNameUpper})`,
        records: [],
        error: "❌ No teachers/subjects assigned for this class.",
        dates: [],
      });
    }

    const subjectMap = {};
    for (let i = 0; i < teachers.length; i++) {
      const t = teachers[i];
      const subj = (t.subject || "").trim();
      if (!subj) continue;

      if (!subjectMap[subj]) {
        subjectMap[subj] = {
          subject: subj,
          teacherName: t.name,
          teacherEmail: t.email,
          extraCount: 0,
        };
      } else {
        subjectMap[subj].extraCount += 1;
      }
    }

    const subjectKeys = Object.keys(subjectMap);
    if (subjectKeys.length === 0) {
      return res.render("reportResult", {
        type: `Class – All Subjects Report (Class: ${classNameUpper})`,
        records: [],
        error: "❌ No subjects found for this class.",
        dates: [],
      });
    }

    let dates = [];
    let current = new Date(fromDate);
    let end = new Date(toDate);
    while (current <= end) {
      dates.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 1);
    }

    const subjectReports = [];
    const studentIds = students.map((student) => student._id);
    const allSubjectRecords = await Attendance.find({
      studentId: { $in: studentIds },
      className: classNameUpper,
      subject: { $in: subjectKeys },
      date: { $gte: fromDate, $lte: toDate },
    });

    for (let s = 0; s < subjectKeys.length; s++) {
      const subjectName = subjectKeys[s];
      const meta = subjectMap[subjectName];
      const filteredRecords = allSubjectRecords.filter((record) => record.subject === subjectName);
      const subjectAttendanceMap = buildStudentAttendanceMap(filteredRecords);

      const records = students.map((student) => {
        const statusMap = subjectAttendanceMap.get(String(student._id)) || {};
        const filledAttendance = {};

        dates.forEach((d) => {
          filledAttendance[d] = statusMap[d] || "Absent";
        });

        return { student, attendance: filledAttendance };
      });

      subjectReports.push({
        subject: subjectName,
        teacherName: meta.teacherName,
        teacherEmail: meta.teacherEmail,
        extraCount: meta.extraCount,
        records,
      });
    }

    res.render("classSubjectReport", {
      className: classNameUpper,
      fromDate,
      toDate,
      dates,
      subjectReports,
      error: null,
    });
  } catch (err) {
    console.error("❌ Error in classSubjectsReport:", err);
    res.render("classSubjectReport", {
      className: "",
      fromDate: "",
      toDate: "",
      dates: [],
      subjectReports: [],
      error: "❌ Error fetching class subject-wise report",
    });
  }
};

// -------------------- ADMIN PROFILE --------------------
const getProfile = async (req, res) => {
  try {
    const userId = req.session.user._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.render("adminProfile", {
        user: null,
        error: "Admin user not found.",
        success: null,
      });
    }

    res.render("adminProfile", {
      user,
      error: null,
      success: null,
    });
  } catch (err) {
    console.error("❌ Admin Profile Load Error:", err);
    res.render("adminProfile", {
      user: null,
      error: "Error loading profile.",
      success: null,
    });
  }
};

const updateProfile = async (req, res) => {
  try {
    const userId = req.session.user._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.render("adminProfile", {
        user: null,
        error: "Admin user not found.",
        success: null,
      });
    }

    const { name, email, password } = req.body;

    if (email && email !== user.email) {
      const existing = await User.findOne({ email });
      if (existing) {
        return res.render("adminProfile", {
          user,
          error: "This email is already taken.",
          success: null,
        });
      }
      user.email = email;
    }

    if (name) {
      user.name = name;
    }

    if (password && password.trim().length > 0) {
      if (password.length < 8) {
        return res.render("adminProfile", {
          user,
          error: "Password must be at least 8 characters.",
          success: null,
        });
      }
      user.password = await bcrypt.hash(password, 10);
    }

    const removePhotoRequested =
      req.body &&
      (req.body.removePhoto === "1" ||
        req.body.removePhoto === "on" ||
        req.body.removePhoto === "true");

    const oldPhoto = user.profilePhoto || null;

    if (req.file) {
      const newPath = "/uploads/" + req.file.filename;
      user.profilePhoto = newPath;

      try {
        if (oldPhoto && oldPhoto.startsWith("/uploads/")) {
          const filename = oldPhoto.replace(/^\/uploads\//, "");
          const filePath = path.join(
            __dirname,
            "..",
            "public",
            "uploads",
            filename
          );
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      } catch (e) {
        console.warn(
          "Warning: failed to delete old profile photo:",
          e && e.message
        );
      }
    } else if (removePhotoRequested) {
      try {
        if (oldPhoto && oldPhoto.startsWith("/uploads/")) {
          const filename = oldPhoto.replace(/^\/uploads\//, "");
          const filePath = path.join(
            __dirname,
            "..",
            "public",
            "uploads",
            filename
          );
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        }
      } catch (e) {
        console.warn(
          "Warning: failed to delete profile photo during remove:",
          e && e.message
        );
      }
      user.profilePhoto = null;
    }

    await user.save();

    req.session.user.name = user.name;
    req.session.user.email = user.email;
    req.session.user.profilePhoto = user.profilePhoto;

    let successMsg = "Profile updated successfully!";
    if (req.file)
      successMsg = "Profile updated and photo uploaded successfully!";
    else if (removePhotoRequested)
      successMsg = "Profile updated and photo removed successfully!";

    res.render("adminProfile", {
      user,
      error: null,
      success: successMsg,
    });
  } catch (err) {
    console.error("❌ Admin Profile Update Error:", err);
    res.render("adminProfile", {
      user: null,
      error: "Error updating profile.",
      success: null,
    });
  }
};

// AJAX endpoint for dashboard panel (returns JSON)
const removeProfilePhoto = async (req, res) => {
  try {
    if (!req.session || !req.session.user || !req.session.user._id) {
      return res.status(401).json({ ok: false, message: "Not authenticated" });
    }

    const userId = req.session.user._id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    const oldPhoto = user.profilePhoto || null;

    if (oldPhoto && oldPhoto.startsWith("/uploads/")) {
      try {
        const filename = oldPhoto.replace(/^\/uploads\//, "");
        const filePath = path.join(
          __dirname,
          "..",
          "public",
          "uploads",
          filename
        );
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (e) {
        console.warn(
          "Warning: failed to delete old profile photo:",
          e && e.message
        );
      }
    }

    user.profilePhoto = null;
    await user.save();

    if (req.session.user) req.session.user.profilePhoto = null;

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ removeProfilePhoto error:", err);
    return res
      .status(500)
      .json({ ok: false, message: "Server error removing photo" });
  }
};

module.exports = {
  getDashboard,
  viewStudents,
  addStudent,
  updateStudent,
  deleteStudent,
  viewTeachers,
  addTeacher,
  updateTeacher,
  deleteTeacher,
  getReports,
  studentReport,
  dateReport,

  classSubjectsReport,
  downloadStudentsCSV,
  getProfile,
  updateProfile,
  removeProfilePhoto,
};
