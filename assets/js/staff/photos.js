// Turning a phone photo into a framed shop picture, automatically.
import { supabase } from '../db.js';
import { loadBitmap, toJpeg, canvasBlob, blobToBase64, renderFrame } from '../frame.js';
import { nameFromFile } from '../lib.js';

const bitmaps = new Map();

async function functionError(error) {
  try {
    const body = await error.context?.json();
    if (body?.error) return body.error;
  } catch { /* not JSON */ }
  return error.message || 'The AI labeller did not answer.';
}

export async function askAI(image) {
  const small = await toJpeg(image, 1024, 0.8);
  const { data, error } = await supabase.functions.invoke('label-toy', {
    body: { image: await blobToBase64(small), media_type: 'image/jpeg' },
  });
  if (error) throw new Error(await functionError(error));
  return data.labels;
}

async function uploadFramed(toyId, image, fields) {
  const canvas = await renderFrame({ image, name: fields.name, tagline: fields.tagline, audience: fields.audience, condition: fields.condition, focus: fields.focus });
  const blob = await canvasBlob(canvas, 0.86);
  const path = `${toyId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('toys').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw error;
  return path;
}

// One new photo -> one toy waiting on the Review page.
// options: price, box_id, audience/condition ('' = let the AI decide),
// labels (from a Claude pack: used instead of asking the AI).
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

    // Labels from a Claude pack come with the photo; otherwise ask the AI.
    let labels = options.labels || null;
    let aiError = '';
    if (!labels) {
      onStep('AI is naming the toy');
      try {
        labels = await askAI(image);
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
    const imagePath = await uploadFramed(toy.id, image, fields);
    const { data: saved, error: saveError } = await supabase.from('toys').update({
      ...fields,
      raw_path: rawPath,
      image_path: imagePath,
      ai_labels: labels ? { ...labels } : { error: aiError },
      needs_attention: !labels || labels.confidence === 'low',
    }).eq('id', toy.id).select().single();
    if (saveError) throw saveError;
    bitmaps.set(toy.id, image);
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
  const { data, error } = await supabase.storage.from('raw').download(toy.raw_path);
  if (error) throw error;
  const image = await loadBitmap(data);
  bitmaps.set(toy.id, image);
  return image;
}

// Redraw the frame after the name, group or condition changed.
export async function reframe(toy, changes) {
  const fields = { name: toy.name, tagline: toy.tagline, audience: toy.audience, condition: toy.condition, focus: toy.focus, ...changes };
  const image = await sourceImage(toy);
  const imagePath = await uploadFramed(toy.id, image, fields);
  const { data, error } = await supabase.from('toys').update({ ...changes, image_path: imagePath })
    .eq('id', toy.id).select().single();
  if (error) throw error;
  if (toy.image_path && toy.image_path !== imagePath) {
    supabase.storage.from('toys').remove([toy.image_path]).catch(() => {});
  }
  return data;
}

// A new photo for an existing toy (keeps its name and details).
export async function replacePhoto(toy, file, { relabel = false } = {}) {
  const image = await loadBitmap(file);
  const raw = await toJpeg(image, 1600, 0.88);
  const rawPath = `${toy.id}.jpg`;
  const up = await supabase.storage.from('raw').upload(rawPath, raw, { contentType: 'image/jpeg', upsert: true });
  if (up.error) throw up.error;
  bitmaps.set(toy.id, image);
  let changes = { raw_path: rawPath };
  if (relabel) {
    const labels = await askAI(image).catch(() => null);
    if (labels) {
      changes = { ...changes, name: labels.name, tagline: labels.tagline || null, focus: labels.focus || null, audience: labels.audience, condition: labels.condition,
        category: labels.category, age_range: labels.age_range, brand: labels.brand || null,
        description: labels.description, ai_labels: labels };
    }
  }
  return reframe({ ...toy, raw_path: rawPath }, changes);
}

export async function deleteToyFiles(toy) {
  const jobs = [];
  if (toy.image_path) jobs.push(supabase.storage.from('toys').remove([toy.image_path]));
  if (toy.raw_path) jobs.push(supabase.storage.from('raw').remove([toy.raw_path]));
  await Promise.allSettled(jobs);
}
