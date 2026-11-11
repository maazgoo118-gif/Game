require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const IMAGE_ENCRYPTION_KEY = process.env.IMAGE_ENCRYPTION_KEY;
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 14 || !SESSION_SECRET || SESSION_SECRET.length < 32 || !/^[a-f0-9]{64}$/i.test(IMAGE_ENCRYPTION_KEY || "")) {
  console.error("Set ADMIN_PASSWORD (14+ chars), SESSION_SECRET (32+ chars), and IMAGE_ENCRYPTION_KEY (64 hex chars).");
  process.exit(1);
}

const encryptionKey = Buffer.from(IMAGE_ENCRYPTION_KEY, "hex");
const uploadDir = path.join(__dirname, "uploads");
const dataDir = path.join(__dirname, "data");
const recordsFile = path.join(dataDir, "records.json");
fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
if (!fs.existsSync(recordsFile)) fs.writeFileSync(recordsFile, "[]", { mode: 0o600 });
function readRecords() { try { return JSON.parse(fs.readFileSync(recordsFile, "utf8")); } catch { return []; } }
function writeRecords(records) { fs.writeFileSync(recordsFile, JSON.stringify(records, null, 2), { mode: 0o600 }); }
function encryptBuffer(input) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  return Buffer.concat([Buffer.from("CP1"), iv, cipher.getAuthTag(), encrypted]);
}
function decryptBuffer(input) {
  if (input.subarray(0, 3).toString() !== "CP1") throw new Error("Unknown encrypted image format");
  const iv = input.subarray(3, 15), tag = input.subarray(15, 31), body = input.subarray(31);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false, referrerPolicy: { policy: "no-referrer" } }));
app.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive"); next(); });
app.use(express.json({ limit: "100kb" }));
app.use(session({
  name: "campro.sid", secret: SESSION_SECRET, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", maxAge: 2 * 60 * 60 * 1000, path: "/" }
}));
app.use(express.static(path.join(__dirname, "public"), { index: "index.html", dotfiles: "deny" }));

const captureLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)) });
function requireAdmin(req, res, next) { if (req.session?.isAdmin) return next(); return res.status(401).json({ error: "تسجيل الدخول مطلوب." }); }
function requireSameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== req.get("host")) return res.sendStatus(403); }
    catch { return res.sendStatus(403); }
  }
  next();
}
app.use("/api/admin", requireSameOrigin);

app.post("/api/capture", captureLimiter, upload.single("photo"), (req, res) => {
  if (req.body.consent !== "true" || req.body.captureNoticeAccepted !== "true") return res.status(400).json({ error: "الموافقة المسبقة مطلوبة." });
  if (!req.file || !req.file.mimetype.startsWith("image/")) return res.status(400).json({ error: "لم تصل صورة صالحة." });
  try {
    const id = crypto.randomUUID();
    const filename = id + ".enc";
    fs.writeFileSync(path.join(uploadDir, filename), encryptBuffer(req.file.buffer), { flag: "wx", mode: 0o600 });
    const records = readRecords();
    records.unshift({ id, filename, createdAt: new Date().toISOString() });
    writeRecords(records);
    res.json({ ok: true, id });
  } catch (e) { console.error("Capture storage failed:", e.message); res.status(500).json({ error: "تعذر حفظ الصورة بأمان." }); }
});

app.post("/api/admin/login", loginLimiter, (req, res) => {
  const supplied = Buffer.from(String(req.body.password || ""));
  const expected = Buffer.from(ADMIN_PASSWORD);
  const valid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  if (!valid) return res.status(401).json({ error: "كلمة المرور غير صحيحة." });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "تعذر بدء الجلسة." });
    req.session.isAdmin = true;
    req.session.save(saveErr => saveErr ? res.status(500).json({ error: "تعذر حفظ الجلسة." }) : res.json({ ok: true }));
  });
});
app.post("/api/admin/logout", requireAdmin, (req, res) => req.session.destroy(() => { res.clearCookie("campro.sid", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" }); res.json({ ok: true }); }));
app.get("/api/admin/photos", requireAdmin, (_req, res) => res.json(readRecords().map(({ id, createdAt }) => ({ id, createdAt }))));
app.get("/api/admin/photos/:id", requireAdmin, (req, res) => {
  const item = readRecords().find(x => x.id === req.params.id);
  if (!item || !/^[a-f0-9-]{36}\.enc$/i.test(item.filename)) return res.sendStatus(404);
  try {
    const plain = decryptBuffer(fs.readFileSync(path.join(uploadDir, item.filename)));
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Disposition", "inline; filename=cam-pro.jpg");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(plain);
  } catch { res.status(500).json({ error: "تعذر فك تشفير الصورة." }); }
});
app.delete("/api/admin/photos/:id", requireAdmin, (req, res) => {
  const records = readRecords(); const item = records.find(x => x.id === req.params.id);
  if (!item) return res.sendStatus(404);
  const file = path.join(uploadDir, item.filename);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  writeRecords(records.filter(x => x.id !== req.params.id));
  res.json({ ok: true });
});
app.get("/admin", (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.listen(PORT, "0.0.0.0", () => console.log(`CAM PRO listening on ${PORT}`));
