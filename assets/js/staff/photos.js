// Turning a phone photo into the plain website photo and the framed social
// media picture, automatically.
import { supabase } from '../db.js';
import { loadBitmap, toJpeg, canvasBlob, blobToBase64, renderFrame, renderPhoto } from '../frame.js';
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

export async function nameToy(image, onStep = () => {}) {
  if (namingMode() === 'online') return askAI(image);
  const { recogniseToy } = await import('./recognise.js');
  return recogniseToy(await toJpeg(image, 512, 0.85), onStep);
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

// The website's plain photo (no frame), made once per photo.
function uploadPlain(toyId, src, focus) {
  return uploadCanvas(`${toyId}/photo-${Date.now()}.jpg`, renderPhoto({ ...src, focus }));
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
        labels = await nameToy(image, onStep);
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
    const [imagePath, photoPath] = await Promise.all([uploadFramed(toy.id, src, fields), uploadPlain(toy.id, src, fields.focus)]);
    const { data: saved, error: saveError } = await supabase.from('toys').update({
      ...fields,
      raw_path: rawPath,
      has_cutout: !!src.cutout,
      image_path: imagePath,
      photo_path: photoPath,
      ai_labels: labels ? { ...labels } : { error: aiError },
      needs_attention: !labels || labels.confidence === 'low',
    }).eq('id', toy.id).select().single();
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
  if (!toy.photo_path && !changes.photo_path) changes = { ...changes, photo_path: await uploadPlain(toy.id, src, fields.focus) };
  const { data, error } = await supabase.from('toys').update({ ...changes, image_path: imagePath })
    .eq('id', toy.id).select().single();
  if (error) throw error;
  if (toy.image_path && toy.image_path !== imagePath) {
    supabase.storage.from('toys').remove([toy.image_path]).catch(() => {});
  }
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
  const photoPath = await uploadPlain(toy.id, bitmaps.get(toy.id), changes.focus ?? null);
  const saved = await reframe({ ...toy, raw_path: rawPath }, { ...changes, photo_path: photoPath });
  if (toy.photo_path) supabase.storage.from('toys').remove([toy.photo_path]).catch(() => {});
  return saved;
}

export async function deleteToyFiles(toy) {
  const jobs = [];
  const shown = [toy.image_path, toy.photo_path].filter(Boolean);
  if (shown.length) jobs.push(supabase.storage.from('toys').remove(shown));
  if (toy.raw_path) jobs.push(supabase.storage.from('raw').remove([toy.raw_path, cutPath(toy.id), platePath(toy.id)]));
  await Promise.allSettled(jobs);
}
