-- Run this in Supabase SQL Editor. Safe for the existing table.
ALTER TABLE public.cam_pro_photos
  ADD COLUMN IF NOT EXISTS mime_type text NOT NULL DEFAULT 'image/jpeg';

ALTER TABLE public.cam_pro_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cam_pro_photos FROM anon, authenticated;
