// "Make a post" page: social media posts for holidays, deals, questions
// and news. The maker itself lives in ../studio/ so it can be previewed
// without signing in.
import { supabase, imageUrl } from '../db.js';
import { shared } from './app.js';

let editor = null;

async function loadToys() {
  const { data, error } = await supabase.from('toys')
    .select('id, code, name, price, sale_price, category, thumb_path, photo_path, image_path, raw_path')
    .in('status', ['available', 'reserved'])
    .order('approved_at', { ascending: false, nullsFirst: false })
    .limit(400);
  if (error) throw error;
  return (data || []).map((t) => ({ ...t, thumb: imageUrl(t.thumb_path || t.photo_path || t.image_path) }));
}

// The original photo when there is one (sharpest, nothing added at the
// edges), otherwise the shop photo.
async function toyImage(toy) {
  if (toy.raw_path) {
    const { data, error } = await supabase.storage.from('raw').download(toy.raw_path);
    if (!error && data) return data;
  }
  const res = await fetch(imageUrl(toy.photo_path || toy.image_path));
  if (!res.ok) throw new Error(`photo ${res.status}`);
  return res.blob();
}

export async function show(main) {
  editor = await import('../studio/editor.js');
  await editor.mount(main, { loadToys, toyImage, settings: shared.settings || {} });
}

export function leave() {
  editor?.unmount();
}
