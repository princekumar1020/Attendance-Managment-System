require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const flash = require("connect-flash");
const helmet = require("helmet");
const connectDB = require("./config/db");
const http = require("http");
const { Server } = require("socket.io");

const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const teacherRoutes = require("./routes/teacherRoutes");

const { isAuthenticated, isAdmin, isTeacher } = require("./middleware/auth");

const app = express();

app.use(helmet());


const UPLOADS_DIR = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log("Created uploads directory at", UPLOADS_DIR);
}


const server = http.createServer(app);
const io = new Server(server);
app.set("io", io);


const onlineTeachers = new Map();

function addOnlineTeacher(teacherId, socketId) {
  if (!teacherId) return;
  const set = onlineTeachers.get(teacherId) || new Set();
  set.add(socketId);
  onlineTeachers.set(teacherId, set);
}

function removeOnlineTeacherBySocket(socketId) {
  for (const [teacherId, sockets] of onlineTeachers.entries()) {
    if (sockets.has(socketId)) {
      sockets.delete(socketId);
      if (sockets.size === 0) onlineTeachers.delete(teacherId);
      return teacherId;
    }
  }
  return null;
}

function getOnlineTeacherIds() {
  return Array.from(onlineTeachers.keys());
}

function broadcastOnlineTeachers() {
  const ids = getOnlineTeacherIds();
  io.to("admins").emit("onlineTeachers:update", { ids });
}

io.on("connection", (socket) => {
  console.log("🔌 New WebSocket connected:", socket.id);

  socket.on("who", (payload) => {
    if (!payload || !payload.role) return;

    if (payload.role === "teacher" && payload.id) {
      addOnlineTeacher(String(payload.id), socket.id);
      socket.join(`teacher:${payload.id}`);
      console.log("Teacher online:", payload.id);
      broadcastOnlineTeachers();
    }

    if (payload.role === "admin") {
      socket.join("admins");
      console.log("Admin connected");
      socket.emit("onlineTeachers:update", { ids: getOnlineTeacherIds() });
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ WebSocket disconnected:", socket.id);
    const teacherId = removeOnlineTeacherBySocket(socket.id);
    if (teacherId) broadcastOnlineTeachers();
  });
  
  socket.on("attendance:update", (data) => {
    io.to("admins").emit("attendance:update", data);
  });
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));


app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, 
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  })
);

app.use(flash());
app.use((req, res, next) => {
  res.locals.messages = req.flash();
  res.locals.currentUser = req.session?.user || null;
  next();
});


const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
});
app.use("/login", authLimiter);
app.use("/signup", authLimiter);

app.set("view engine", "ejs");


app.use("/", authRoutes);
app.use("/admin", isAuthenticated, isAdmin, adminRoutes);
app.use("/teacher", isAuthenticated, isTeacher, teacherRoutes);

app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout Error:", err);
      return res.redirect("/");
    }
    res.clearCookie("connect.sid"); 
    res.render("logout"); 
  });
});


app.use((req, res) => res.status(404).send("404 Not Found"));

app.use((err, req, res, next) => {
  if (err && (err.code === "LIMIT_FILE_SIZE" || err.code === "INVALID_FILE_TYPE")) {
    return res.status(400).send(
      "Invalid profile image. Please upload a JPEG, PNG, or WebP image no larger than 2 MB."
    );
  }

  console.error("Global Error:", err);
  res.status(500).send("Server Error");
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  await connectDB();

  server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log("Socket.IO online");
  });
}

startServer().catch(() => {
  console.error("Application startup failed: MongoDB is unavailable.");
  process.exit(1);
});