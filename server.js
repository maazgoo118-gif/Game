require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const helmet = require('helmet');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const { ADMIN_PASSWORD, SESSION_SECRET, IMAGE_ENCRYPTION_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 14 || !SESSION_SECRET || SESSION_SECRET.length < 32 || !/^[a-f0-9]{64}$/i.test(IMAGE_ENCRYPTION_KEY || '') || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error('Missing configuration. Set ADMIN_PASSWORD (14+ chars), SESSION_SECRET (32+ chars), IMAGE_ENCRYPTION_KEY (64 hex chars), SUPABASE_URL and SUPABASE_SECRET_KEY.');
  process.exit(1);
}
const BUCKET = process.env.SUPABASE_BUCKET || 'cam-pro-photos';
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const encryptionKey = Buffer.from(IMAGE_ENCRYPTION_KEY, 'hex');
const appSessionKeys = [SESSION_SECRET];

function encryptBuffer(input) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const body = Buffer.concat([cipher.update(input), cipher.final()]);
  return Buffer.concat([Buffer.from('CP1'), iv, cipher.getAuthTag(), body]);
}
function decryptBuffer(input) {
  if (input.subarray(0, 3).toString() !== 'CP1' || input.length < 32) throw new Error('Invalid encrypted image');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, input.subarray(3, 15));
  decipher.setAuthTag(input.subarray(15, 31));
  return Buffer.concat([decipher.update(input.subarray(31)), decipher.final()]);
}
function validImage(buffer, mime) {
  if (mime === 'image/jpeg') return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === 'image/webp') return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  return false;
}

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, referrerPolicy: { policy: 'no-referrer' } }));
app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive'); next(); });
app.use(express.json({ limit: '20kb' }));
app.use(cookieSession({ name: 'campro.sid', keys: appSessionKeys, maxAge: 2 * 60 * 60 * 1000, httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' }));
app.use(express.static(require('path').join(__dirname, 'public'), { index: 'index.html', dotfiles: 'deny' }));

const captureLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 *  1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => cb(null, ['image/jpeg','image/png','image/webp'].includes(file.mimetype)) });
function requireAdmin(req, res, next) { if (req.session && req.session.isAdmin === true) return next(); return res.status(401).json({ error: 'تسجيل الدخول مطلوب.' }); }
function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin) { try { if (new URL(origin).host !== req.get('host')) return res.sendStatus(403); } catch { return res.sendStatus(403); } }
  next();
}
app.use('/api/admin', sameOrigin);

app.post('/api/capture', captureLimiter, upload.single('photo'), async (req, res) => {
  if (req.body.consent !== 'true' || req.body.captureNoticeAccepted !== 'true') return res.status(400).json({ error: 'الموافقة المسبقة مطلوبة.' });
  if (!req.file || !validImage(req.file.buffer, req.file.mimetype)) return res.status(400).json({ error: 'ملف الصورة غير صالح.' });
  const id = crypto.randomUUID();
  const storagePath = `${id}.cp1`;
  try {
    const encrypted = encryptBuffer(req.file.buffer);
    const { error: storageError } = await supabase.storage.from(BUCKET).upload(storagePath, encrypted, { contentType: 'application/octet-stream', upsert: false });
    if (storageError) throw storageError;
    const { error: dbError } = await supabase.from('cam_pro_photos').insert({ id, storage_path: storagePath, mime_type: req.file.mimetype });
    if (dbError) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      throw dbError;
    }
    return res.json({ ok: true, id });
  } catch (e) { console.error('Capture storage failed:', e.message); return res.status(500).json({ error: 'تعذر حفظ الصورة بأمان.' }); }
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const supplied = Buffer.from(String(req.body.password || ''));
  const expected = Buffer.from(ADMIN_PASSWORD);
  const valid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  if (!valid) return res.status(401).json({ error: 'كلمة المرور غير صحيحة.' });
  req.session = { isAdmin: true, issuedAt: Date.now() };
  return res.json({ ok: true });
});
app.post('/api/admin/logout', requireAdmin, (req, res) => { req.session = null; res.clearCookie('campro.sid', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/' }); res.json({ ok: true }); });
app.get('/api/admin/photos', requireAdmin, async (_req, res) => {
  const { data, error } = await supabase.from('cam_pro_photos').select('id, created_at').order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: 'تعذر تحميل الصور.' });
  res.json(data.map(x => ({ id: x.id, createdAt: x.created_at })));
});
app.get('/api/admin/photos/:id', requireAdmin, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.sendStatus(404);
  const { data: row, error: rowError } = await supabase.from('cam_pro_photos').select('storage_path,mime_type').eq('id', req.params.id).maybeSingle();
  if (rowError || !row) return res.sendStatus(404);
  const { data: file, error } = await supabase.storage.from(BUCKET).download(row.storage_path);
  if (error || !file) return res.status(500).json({ error: 'تعذر تحميل الصورة.' });
  try {
    const plain = decryptBuffer(Buffer.from(await file.arrayBuffer()));
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline; filename="cam-pro-image"');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(plain);
  } catch { return res.status(500).json({ error: 'تعذر فك تشفير الصورة.' }); }
});
app.delete('/api/admin/photos/:id', requireAdmin, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.sendStatus(404);
  const { data: row, error: readError } = await supabase.from('cam_pro_photos').select('storage_path').eq('id', req.params.id).maybeSingle();
  if (readError || !row) return res.sendStatus(404);
  const { error: removeError } = await supabase.storage.from(BUCKET).remove([row.storage_path]);
  if (removeError) return res.status(500).json({ error: 'تعذر حذف ملف الصورة.' });
  const { error: deleteError } = await supabase.from('cam_pro_photos').delete().eq('id', req.params.id);
  if (deleteError) return res.status(500).json({ error: 'حُذف الملف لكن تعذر حذف السجل.' });
  res.json({ ok: true });
});
app.get('/admin', (_req, res) => res.sendFile(require('path').join(__dirname, 'public', 'admin.html')));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.listen(PORT, '0.0.0.0', () => console.log(`CAM PRO listening on ${PORT}`));
