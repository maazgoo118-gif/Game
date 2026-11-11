# CAM PRO

CAM PRO is a consent-based camera game. Before the camera is requested, the participant must read and accept the notice explaining that a photo is captured immediately after permission is granted and uploaded to the private owner gallery. Do not use this project to capture or upload anyone's image without their informed, explicit consent.

## Storage and deployment
- Images are encrypted in the Node.js server with AES-256-GCM before upload.
- Encrypted image files are stored in the **private** Supabase Storage bucket `cam-pro-photos`.
- Metadata is stored in `public.cam_pro_photos`.
- The Supabase secret key is server-side only. Never place it in browser JavaScript or commit it to GitHub.
- No image files or database records are stored on the Render filesystem.
- The admin login cookie is signed, HTTP-only, SameSite Strict, and expires after two hours. It is stateless; logging out clears it.

## Supabase SQL
Run once in Supabase SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS public.cam_pro_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL DEFAULT 'image/jpeg',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cam_pro_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cam_pro_photos FROM anon, authenticated;
```

If the table already exists from an earlier setup, run this additional statement:

```sql
ALTER TABLE public.cam_pro_photos ADD COLUMN IF NOT EXISTS mime_type text NOT NULL DEFAULT 'image/jpeg';
```

Create a **private** Storage bucket named `cam-pro-photos`. Do not add public read policies. The server uses the Supabase secret key to access Storage and the table.

## Render environment variables
Set these in Render Dashboard > your Web Service > Environment:
- `ADMIN_PASSWORD`: unique password, at least 14 characters.
- `SESSION_SECRET`: random secret, at least 32 characters.
- `IMAGE_ENCRYPTION_KEY`: exactly 64 hexadecimal characters (32 random bytes). Keep a secure backup; losing it makes stored images unrecoverable.
- `SUPABASE_URL`: project URL.
- `SUPABASE_SECRET_KEY`: Supabase server secret key (`sb_secret_...`). Never expose it to the browser.
- `SUPABASE_BUCKET`: `cam-pro-photos`.
- `NODE_ENV`: `production`.

Build command: `npm install`
Start command: `npm start`

Use Node 20 or newer. Check `/health` after deployment. Test consent, upload, admin login, image viewing, deletion, and logout before sharing the app.
