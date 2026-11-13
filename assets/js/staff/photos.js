// Turning a phone photo into the plain website photo and the framed social
// media picture, automatically.
import { supabase, imageUrl } from '../db.js';
import { loadBitmap, toJpeg, canvasBlob, blobToBase64, renderFrame, renderPhoto, mirrored } from '../frame.js';
import { nameFromFile } from '../lib.js';

const bitmaps = new Map();

async function functionError(error) {
  try {
    const body = await error.context?.json();
    if (body?.error) return body.error;
  } catch { /* not JSON */ }
  const status = error.context?.status;
  return status ? `the AI service answered ${status}` : error.message || 'The AI labeller did not answer.';
}

// How toys get named: 'device' (free, recognised in this browser) or
// 'online' (the label-toy function with a Gemini or Anthropic key).
export function namingMode() {
  try { return localStorage.getItem('naming') === 'online' ? 'online' : 'device'; } catch { return 'device'; }
}
export function setNamingMode(mode) {
  try { localStorage.setItem('naming', mode); } catch { /* blocked: stays on device */ }
}

// vector: the photo's numbers, when the upload page already worked them out.
export async function nameToy(image, onStep = () => {}, vector = null) {
  if (namingMode() === 'online') return askAI(image);
  const { recogniseToy } = await import('./recognise.js');
  return recogniseToy(await toJpeg(image, 512, 0.85), onStep, vector);
}

export async function askAI(image) {
  const small = await toJpeg(image, 1024, 0.8);
  const body = { image: await blobToBase64(small), media_type: 'image/jpeg' };
  // The free AI allows only a few photos a minute and is sometimes busy:
  // wait and try again.
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.functions.invoke('label-toy', { body });
    if (!error) return data.labels;
    const status = error.context?.status;
    if ([429, 500, 502, 503, 504, 546].includes(status) && attempt < 4) {
      await new Promise((r) => setTimeout(r, status === 429 ? 15000 : 6000 * (attempt + 1)));
      continue;
    }
    throw new Error(await functionError(error));
  }
}

// src: { image, cutout, plate } (cutout and plate come with Claude packs).
async function uploadFramed(toyId, src, fields) {
  const canvas = await renderFrame({ ...src, name: fields.name, tagline: fields.tagline, audience: fields.audience,
    condition: fields.condition, focus: fields.focus });
  return uploadCanvas(`${toyId}/${Date.now()}.jpg`, canvas);
}

async function uploadCanvas(path, canvas) {
  const blob = await canvasBlob(canvas, 0.86);
  const { error } = await supabase.storage.from('toys').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw error;
  return path;
}

// The website's plain photo (no frame), made once per photo, plus a small
// copy for the shop's toy cards. Returns { photo_path, thumb_path }.
const THUMB = 480;
function shrink(canvas, size = THUMB) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, size, size);
  return c;
}
async function uploadThumb(toyId, canvas) {
  const blob = await canvasBlob(shrink(canvas), 0.8);
  const path = `${toyId}/thumb-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('toys').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw error;
  return path;
}
async function uploadPlain(toyId, src, focus) {
  const canvas = renderPhoto({ ...src, focus });
  const [photo_path, thumb_path] = await Promise.all([
    uploadCanvas(`${toyId}/photo-${Date.now()}.jpg`, canvas),
    uploadThumb(toyId, canvas),
  ]);
  return { photo_path, thumb_path };
}

// Toys from before thumbnails existed: make one from the plain photo.
export async function makeThumb(toy) {
  const res = await fetch(imageUrl(toy.photo_path));
  if (!res.ok) throw new Error(`photo ${res.status}`);
  const img = await loadBitmap(await res.blob());
  const c = document.createElement('canvas');
  const side = Math.min(img.width, img.height);
  c.width = c.height = side;
  c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, side, side);
  const thumb_path = await uploadThumb(toy.id, c);
  const { error } = await saveToy(toy.id, { thumb_path });
  if (error) throw error;
  return thumb_path;
}

// Saves changes to a toy. Until the latest database file is run, some newer
// columns (like thumb_path) do not exist yet: leave those out and save the rest.
export async function saveToy(id, changes) {
  let rest = { ...changes };
  for (let i = 0; i < 4; i++) {
    const res = await supabase.from('toys').update(rest).eq('id', id).select().single();
    const missing = /Could not find the '([^']+)' column|column [^ ]*\.?"?([a-z_]+)"? of relation|column "?([a-z_]+)"? does not exist/i.exec(res.error?.message || '');
    const col = missing && (missing[1] || missing[2] || missing[3]);
    if (!col || !(col in rest)) return res;
    delete rest[col];
  }
  return supabase.from('toys').update(rest).eq('id', id).select().single();
}

// One new photo -> one toy waiting on the Review page.
// options: price, box_id, audience/condition ('' = let the AI decide),
// labels (from a Claude pack: used instead of asking the AI), cutout and plate
// (from a Claude pack: the toy cut out, and the photo with the toy painted
// out, so the frame can fill the window and let the toy pop out).
const cutPath = (id) => `${id}-cut.png`;
const platePath = (id) => `${id}-plate.jpg`;
export async function addToyFromPhoto(file, options, onStep = () => {}) {
  onStep('Preparing photo');
  const image = await loadBitmap(file);
  const raw = await toJpeg(image, 1600, 0.88);

  const { data: toy, error } = await supabase.from('toys').insert({
    status: 'review',
    price: options.labels?.price || options.price,
    box_id: options.box_id || null,
    name: 'New toy',
  }).select().single();
  if (error) throw error;

  try {
    const rawPath = `${toy.id}.jpg`;
    const up = await supabase.storage.from('raw').upload(rawPath, raw, { contentType: 'image/jpeg', upsert: true });
    if (up.error) throw up.error;
    const src = { image, cutout: null, plate: null };
    if (options.cutout && options.plate) {
      const [a, b] = await Promise.all([
        supabase.storage.from('raw').upload(cutPath(toy.id), options.cutout, { contentType: 'image/png', upsert: true }),
        supabase.storage.from('raw').upload(platePath(toy.id), options.plate, { contentType: 'image/jpeg', upsert: true }),
      ]);
      if (a.error || b.error) throw a.error || b.error;
      [src.cutout, src.plate] = await Promise.all([loadBitmap(options.cutout), loadBitmap(options.plate)]);
    }

    // Labels from a Claude pack come with the photo; otherwise recognise it.
    let labels = options.labels || null;
    let aiError = '';
    if (!labels) {
      onStep('Naming the toy');
      try {
        labels = await nameToy(image, onStep, options.vector);
      } catch (e) {
        aiError = e.message;
      }
    }

    const fields = {
      name: (options.labels && labels.name) || nameFromFile(file.name) || labels?.name || 'Unnamed toy',
      tagline: labels?.tagline || null,
      focus: labels?.focus || null,
      audience: options.audience || labels?.audience || 'neutral',
      condition: options.condition || labels?.condition || 'used',
      category: labels?.category || null,
      age_range: labels?.age_range || null,
      brand: labels?.brand || null,
      description: labels?.description || null,
    };

    onStep('Adding the frame');
    const [imagePath, plain] = await Promise.all([uploadFramed(toy.id, src, fields), uploadPlain(toy.id, src, fields.focus)]);
    const { data: saved, error: saveError } = await saveToy(toy.id, {
      ...fields,
      raw_path: rawPath,
      has_cutout: !!src.cutout,
      image_path: imagePath,
      ...plain,
      ai_labels: labels ? { ...labels } : { error: aiError },
      needs_attention: !labels || labels.confidence === 'low',
    });
    if (saveError) throw saveError;
    bitmaps.set(toy.id, src);
    return { toy: saved, aiError };
  } catch (e) {
    // Don't leave a half-made toy behind.
    await supabase.from('toys').delete().eq('id', toy.id);
    throw e;
  }
}

async function sourceImage(toy) {
  if (bitmaps.has(toy.id)) return bitmaps.get(toy.id);
  if (!toy.raw_path) throw new Error('This toy has no original photo. Use "Replace photo" to add one.');
  const get = async (path) => {
    const { data, error } = await supabase.storage.from('raw').download(path);
    if (error) throw error;
    return loadBitmap(data);
  };
  const src = { image: await get(toy.raw_path), cutout: null, plate: null };
  if (toy.has_cutout) {
    try {
      [src.cutout, src.plate] = await Promise.all([get(cutPath(toy.id)), get(platePath(toy.id))]);
    } catch {
      src.cutout = src.plate = null;
    }
  }
  bitmaps.set(toy.id, src);
  return src;
}

// Redraw the frame after the name, group or condition changed.
export async function reframe(toy, changes) {
  const fields = { name: toy.name, tagline: toy.tagline, audience: toy.audience, condition: toy.condition, focus: toy.focus, ...changes };
  const src = await sourceImage(toy);
  const imagePath = await uploadFramed(toy.id, src, fields);
  // Toys from before the website used plain photos get theirs now.
  if (!toy.photo_path && !changes.photo_path) changes = { ...changes, ...(await uploadPlain(toy.id, src, fields.focus)) };
  const { data, error } = await saveToy(toy.id, { ...changes, image_path: imagePath });
  if (error) throw error;
  if (toy.image_path && toy.image_path !== imagePath) {
    supabase.storage.from('toys').remove([toy.image_path]).catch(() => {});
  }
  return data;
}

// More photos (made smaller) and videos of a toy, kept in toys.media as
// [{ path, type: 'image' | 'video' }]. The first photo stays the main one.
const VIDEO_MAX = 50 * 1024 * 1024;
export async function addMedia(toy, files) {
  const added = [];
  for (const file of files) {
    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|3gp)$/i.test(file.name);
    if (isVideo && file.size > VIDEO_MAX) throw new Error(`${file.name} is over 50 MB. Record a shorter video or send it smaller.`);
    const blob = isVideo ? file : await toJpeg(await loadBitmap(file), 1600, 0.86);
    const ext = isVideo ? (file.name.split('.').pop() || 'mp4').toLowerCase() : 'jpg';
    const path = `${toy.id}/media-${Date.now()}-${added.length}.${ext}`;
    const { error } = await supabase.storage.from('toys').upload(path, blob, {
      contentType: isVideo ? file.type || 'video/mp4' : 'image/jpeg', cacheControl: '31536000',
    });
    if (error) throw error;
    added.push({ path, type: isVideo ? 'video' : 'image' });
  }
  return saveMedia(toy, [...(toy.media || []), ...added]);
}

export async function removeMedia(toy, path) {
  const saved = await saveMedia(toy, (toy.media || []).filter((m) => m.path !== path));
  supabase.storage.from('toys').remove([path]).catch(() => {});
  return saved;
}

async function saveMedia(toy, media) {
  const { data, error } = await supabase.from('toys').update({ media }).eq('id', toy.id).select().single();
  if (error) throw error;
  return data;
}

// Ask the AI again for a toy it could not name (keeps price and stock).
export async function relabel(toy) {
  const src = await sourceImage(toy);
  const labels = await nameToy(src.image);
  return reframe(toy, {
    name: labels.name, tagline: labels.tagline || null, audience: labels.audience, condition: labels.condition,
    category: labels.category, age_range: labels.age_range, brand: labels.brand || null,
    description: labels.description, ai_labels: labels, needs_attention: labels.confidence === 'low',
    ...(toy.has_cutout ? {} : { focus: labels.focus || null }),
  });
}

// A new photo for an existing toy (keeps its name and details).
export async function replacePhoto(toy, file, { relabel = false } = {}) {
  const image = await loadBitmap(file);
  const raw = await toJpeg(image, 1600, 0.88);
  const rawPath = `${toy.id}.jpg`;
  const up = await supabase.storage.from('raw').upload(rawPath, raw, { contentType: 'image/jpeg', upsert: true });
  if (up.error) throw up.error;
  // A new photo: the old cutout and toy position no longer match it.
  bitmaps.set(toy.id, { image, cutout: null, plate: null });
  let changes = { raw_path: rawPath, has_cutout: false, focus: null };
  if (relabel) {
    const labels = await nameToy(image).catch(() => null);
    if (labels) {
      changes = { ...changes, name: labels.name, tagline: labels.tagline || null, focus: labels.focus || null, audience: labels.audience, condition: labels.condition,
        category: labels.category, age_range: labels.age_range, brand: labels.brand || null,
        description: labels.description, ai_labels: labels };
    }
  }
  const plain = await uploadPlain(toy.id, bitmaps.get(toy.id), changes.focus ?? null);
  const saved = await reframe({ ...toy, raw_path: rawPath }, { ...changes, ...plain });
  const old = [toy.photo_path, toy.thumb_path].filter(Boolean);
  if (old.length) supabase.storage.from('toys').remove(old).catch(() => {});
  return saved;
}

// Turn a toy's photo back the right way round (left and right swapped), for
// photos the camera saved mirrored. Redoes the original, the website photo,
// its small copy and the social media picture.
export async function flipToy(toy) {
  let src;
  if (toy.raw_path || bitmaps.has(toy.id) || !toy.photo_path) src = await sourceImage(toy);
  else {
    // Older toys with no original kept: start from the website photo.
    const res = await fetch(imageUrl(toy.photo_path));
    if (!res.ok) throw new Error(`photo ${res.status}`);
    src = { image: await loadBitmap(await res.blob()), cutout: null, plate: null };
  }
  const image = mirrored(src.image);
  const raw = await toJpeg(image, 1600, 0.88);
  const rawPath = toy.raw_path || `${toy.id}.jpg`;
  const up = await supabase.storage.from('raw').upload(rawPath, raw, { contentType: 'image/jpeg', upsert: true, cacheControl: '60' });
  if (up.error) throw up.error;
  const next = { image, cutout: null, plate: null };
  if (src.cutout && src.plate) {
    next.cutout = mirrored(src.cutout);
    next.plate = mirrored(src.plate);
    const [cut, plate] = await Promise.all([
      new Promise((res, rej) => next.cutout.toBlob((b) => (b ? res(b) : rej(new Error('Could not save the picture.'))), 'image/png')),
      canvasBlob(next.plate, 0.88),
    ]);
    const [a, b] = await Promise.all([
      supabase.storage.from('raw').upload(cutPath(toy.id), cut, { contentType: 'image/png', upsert: true, cacheControl: '60' }),
      supabase.storage.from('raw').upload(platePath(toy.id), plate, { contentType: 'image/jpeg', upsert: true, cacheControl: '60' }),
    ]);
    if (a.error || b.error) throw a.error || b.error;
  }
  bitmaps.set(toy.id, next);
  // Where the toy sits in the photo swaps sides too.
  const f = Array.isArray(toy.focus) && toy.focus.length === 4 ? toy.focus.map(Number) : null;
  const focus = f ? [1 - f[2], f[1], 1 - f[0], f[3]] : null;
  const plain = await uploadPlain(toy.id, next, focus);
  const saved = await reframe({ ...toy, raw_path: rawPath, focus }, { raw_path: rawPath, focus, has_cutout: !!next.cutout, ...plain });
  const old = [toy.photo_path, toy.thumb_path].filter(Boolean);
  if (old.length) supabase.storage.from('toys').remove(old).catch(() => {});
  return saved;
}

// The same for one of the extra gallery photos.
export async function flipMedia(toy, path) {
  const res = await fetch(imageUrl(path));
  if (!res.ok) throw new Error(`photo ${res.status}`);
  const blob = await canvasBlob(mirrored(await loadBitmap(await res.blob()), 1600), 0.86);
  const newPath = `${toy.id}/media-${Date.now()}-f.jpg`;
  const { error } = await supabase.storage.from('toys').upload(newPath, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw error;
  const saved = await saveMedia(toy, (toy.media || []).map((m) => (m.path === path ? { ...m, path: newPath } : m)));
  supabase.storage.from('toys').remove([path]).catch(() => {});
  return saved;
}

export async function deleteToyFiles(toy) {
  const jobs = [];
  const shown = [toy.image_path, toy.photo_path, toy.thumb_path, ...(toy.media || []).map((m) => m.path)].filter(Boolean);
  if (shown.length) jobs.push(supabase.storage.from('toys').remove(shown));
  if (toy.raw_path) jobs.push(supabase.storage.from('raw').remove([toy.raw_path, cutPath(toy.id), platePath(toy.id)]));
  await Promise.allSettled(jobs);
}
