require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const UPLOADS = path.join(ROOT, "uploads");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "records.json");

for (const dir of [UPLOADS, DATA_DIR]) fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]");

if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD) {
  console.error("Set SESSION_SECRET and ADMIN_PASSWORD in your .env file.");
  process.exit(1);
}

app.set("trust proxy", 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: "same-site" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "blob:", "data:"],
      connectSrc: ["'self'"],
      mediaSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null
    }
  }
}));
app.use(express.json({ limit: "100kb" }));
app.use(session({
  name: "trapcam.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false });
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

function readRecords() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return []; }
}
function writeRecords(records) {
  const temp = DB_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(records, null, 2));
  fs.renameSync(temp, DB_FILE);
}
function isAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "يلزم تسجيل دخول صاحب المشروع." });
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, _file, cb) => cb(null, crypto.randomUUID() + ".jpg")
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) cb(null, true);
    else cb(new Error("يسمح فقط بملفات الصور."));
  }
});

app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"] }));

app.post("/api/login", loginLimiter, (req, res) => {
  const password = req.body && req.body.password;
  if (!safeEqual(password || "", process.env.ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "كلمة المرور غير صحيحة." });
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "تعذر إنشاء جلسة آمنة." });
    req.session.isAdmin = true;
    res.json({ ok: true });
  });
});

app.post("/api/logout", isAdmin, (req, res) => {
  req.session.destroy(() => res.clearCookie("trapcam.sid", { sameSite: "strict" }).json({ ok: true }));
});
app.get("/api/me", (req, res) => res.json({ isAdmin: !!(req.session && req.session.isAdmin) }));

app.post("/api/photos", uploadLimiter, upload.single("photo"), (req, res) => {
  if (!req.body || req.body.consent !== "yes") {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: "يلزم تأكيد الموافقة على إرسال الصورة." });
  }
  if (!req.file) return res.status(400).json({ error: "لم تصل صورة." });
  const records = readRecords();
  const item = {
    id: crypto.randomUUID(),
    filename: req.file.filename,
    createdAt: new Date().toISOString(),
    note: "أُرسلت بعد موافقة المشارك"
  };
  records.unshift(item);
  writeRecords(records);
  res.json({ ok: true, message: "وصلت الصورة إلى لوحة صاحب المشروع." });
});

app.get("/api/photos", isAdmin, (_req, res) => {
  const records = readRecords().map(({ id, createdAt, note }) => ({ id, createdAt, note }));
  res.json(records);
});
app.get("/api/photos/:id", isAdmin, (req, res) => {
  const item = readRecords().find(x => x.id === req.params.id);
  if (!item) return res.status(404).send("الصورة غير موجودة.");
  res.type("jpg").sendFile(path.join(UPLOADS, item.filename));
});
app.delete("/api/photos/:id", isAdmin, (req, res) => {
  const records = readRecords();
  const item = records.find(x => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: "الصورة غير موجودة." });
  const file = path.join(UPLOADS, item.filename);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  writeRecords(records.filter(x => x.id !== req.params.id));
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error(err.message);
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE")
    return res.status(413).json({ error: "حجم الصورة أكبر من 5 ميغابايت." });
  res.status(400).json({ error: err.message || "حدث خطأ غير متوقع." });
});

app.listen(PORT, () => console.log(`TRAP CAM running at http://localhost:${PORT}`));
