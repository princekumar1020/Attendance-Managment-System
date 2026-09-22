const express = require("express");
const router = express.Router();
const path = require("path");
const multer = require("multer");
const adminController = require("../controllers/adminController");

const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];

// ----------------- Multer config -----------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../public/uploads"));
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname.replace(/\s+/g, "-");
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
      return cb(null, true);
    }

    const error = new Error("Unsupported profile image type");
    error.code = "INVALID_FILE_TYPE";
    cb(error);
  },
});

// ----------------- Dashboard -----------------
router.get("/dashboard", adminController.getDashboard);

// ----------------- Students -----------------
router.get("/students", adminController.viewStudents);
router.post("/students/add", adminController.addStudent);
router.post("/students/update", adminController.updateStudent);
router.post("/students/delete", adminController.deleteStudent);

// ----------------- Teachers -----------------
router.get("/teachers", adminController.viewTeachers);
router.post("/teachers/add", adminController.addTeacher);
router.post("/teachers/update", adminController.updateTeacher);
router.post("/teachers/delete", adminController.deleteTeacher);

// ----------------- Reports -----------------
router.get("/reports", adminController.getReports);
router.post("/reports/student", adminController.studentReport);
router.post("/reports/date", adminController.dateReport);

router.post("/reports/class-subjects", adminController.classSubjectsReport);


// ----------------- Profile -----------------
router.get("/profile", adminController.getProfile);

// profile update (photo upload + remove checkbox)
router.post(
  "/profile",
  upload.single("profilePhoto"),
  adminController.updateProfile
);

// ajax remove photo
router.post("/profile/remove-photo", adminController.removeProfilePhoto);

module.exports = router;
