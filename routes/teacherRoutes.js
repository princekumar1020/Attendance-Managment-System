const express = require("express");
const path = require("path");
const multer = require("multer");
const router = express.Router();
const teacherController = require("../controllers/teacherController");

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
router.get("/dashboard", teacherController.getDashboard);

// ----------------- Attendance -----------------
router.post("/attendance/mark", teacherController.markAttendance);

// ✅ SAFE CHECK
// agar future me remove bhi ho jaaye to crash nahi karega
if (typeof teacherController.viewAttendanceRange === "function") {
  router.get(
    "/attendance/range",
    teacherController.viewAttendanceRange
  );
}

// ----------------- Profile -----------------
router.get("/profile", teacherController.getProfile);

router.post(
  "/profile",
  upload.single("profilePhoto"),
  teacherController.updateProfile
);

module.exports = router;
