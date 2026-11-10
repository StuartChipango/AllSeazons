import { esc, kwacha, parseCsv, packLabels, labelKey } from '../lib.js';
import { readZip } from '../unzip.js';
import { friendlyError } from '../db.js';
import { shared, refreshBadges } from './app.js';
import { $, $$, seg } from './ui.js';
import { addToyFromPhoto, addMedia, namingMode, setNamingMode } from './photos.js';
import { loadBitmap, toJpeg } from '../frame.js';

const opts = { price: null, audience: '', condition: '', box_id: '', group: 'on' };
// How alike two photos must be to count as the same toy from another angle.
const SAME_TOY = 0.9;
const jobs = [];
let running = 0;
let root = null;
// One photo at a time on a phone, so big camera photos do not run it out of memory.
const PARALLEL = window.matchMedia?.('(pointer: coarse)').matches ? 1 : 2;
let notice = null;
let moreOpen = false;

export async function show(main) {
  root = main;
  if (opts.price === null) opts.price = shared.tiers[0] ?? 50;
  render();
  // Photos picked from the + menu.
  if (shared.pendingFiles) {
    const files = shared.pendingFiles;
    shared.pendingFiles = null;
    addFiles(files);
  }
}

export function leave() {
  root?.classList.remove('page-snap');
  root?.removeAttribute('ondragover');
  if (root) root.ondragover = root.ondragleave = root.ondrop = null;
  root = null;
}

const CAMERA = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>';
const GALLERY = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>';

function render() {
  if (!root) return;
  root.classList.add('page-snap');
  const done = jobs.filter((j) => j.state === 'done').length;
  const named = jobs.filter((j) => j.state === 'done' && j.toy && !/^Unnamed/i.test(j.toy.name)).length;
  root.innerHTML = `
    <div class="page-head"><a class="back" href="#home" aria-label="Back">‹</a><h1>Snap new toys</h1></div>

    <span class="lbl">Price for this batch</span>
    <div class="snap-price" id="tierChips">${shared.tiers.map((p) =>
      `<button class="chip" data-opt="price" data-value="${p}" aria-pressed="${p === opts.price}">${kwacha(p)}</button>`).join('')}
      <label class="chip" style="gap:4px">Other K<input type="number" min="1" id="otherPrice" style="width:72px;min-height:28px;padding:2px 6px;border-width:1.5px" value="${shared.tiers.includes(opts.price) ? '' : opts.price}"></label>
    </div>

    <section class="snap-card" aria-live="polite">
      <h2>${jobs.length ? `${done} of ${jobs.length} ready` : 'Ready when you are'}</h2>
      <p>${jobs.length ? (done < jobs.length ? 'Keep going! Each toy gets its name while you take the next one.' : `${named} named. Check them in Review.`) : 'Tap the orange button. One photo per toy, or a few angles in a row.'}</p>
      <img class="mascot" src="../assets/img/mascots/auty.webp" alt="" width="76" height="100" loading="lazy" decoding="async">
    </section>
    ${notice ? `<p class="${notice.bad ? 'st bad' : 'st ok'}" role="status">${esc(notice.text)}</p>` : ''}

    ${jobs.length ? `<ul class="queue">${jobs.map((j) => `
      <li>
        ${j.video ? '<span class="vid-thumb" aria-hidden="true">▶</span>' : `<img src="${esc(j.thumb)}" alt="">`}
        <div><div class="nm">${esc(j.toy?.name || (j.state === 'done' ? j.file.name : 'Naming…'))}</div>
          <div class="st ${j.state === 'done' ? 'ok' : j.state === 'error' ? 'bad' : ''}">${esc(j.step)}</div></div>
        <div>${j.toy ? `<span class="pill">${esc(j.toy.code)}</span>` : ''}</div>
      </li>`).join('')}</ul>` : ''}

    <details class="more-box" id="moreOpts" ${moreOpen ? 'open' : ''}><summary>More options</summary>
      <div class="card-box opts">
        <span class="lbl">Naming</span>
        ${seg('naming', namingMode(), [['device', 'On this device (free)'], ['online', 'Online AI (needs a key)']])}
        <span class="lbl" style="margin-top:10px">Several photos of one toy</span>
        ${seg('group', opts.group, [['on', 'Group them into one toy'], ['off', 'Every photo is a new toy']])}
        <small style="color:var(--muted)">Take the angles of one toy one after another. A video goes with the photo just before it.</small>
        <span class="lbl" style="margin-top:10px">Boys, girls or neutral</span>
        ${seg('audience', opts.audience, [['', 'Let AI decide'], ['boys', 'Boys'], ['girls', 'Girls'], ['neutral', 'Neutral']])}
        <span class="lbl" style="margin-top:10px">Used or new</span>
        ${seg('condition', opts.condition, [['', 'Let AI decide'], ['used', 'Used'], ['new', 'New']])}
        <label class="field" style="margin:10px 0 0;max-width:340px"><span>Box (optional)</span>
          <select id="boxSel"><option value="">No box</option>${shared.boxes.map((b) =>
            `<option value="${esc(b.id)}" ${b.id === opts.box_id ? 'selected' : ''}>${esc(b.id)}${b.supplier ? ' · ' + esc(b.supplier) : ''}</option>`).join('')}</select>
        </label>
        <div class="row-actions" style="justify-content:flex-start;margin-top:12px">
          <label class="btn ghost small">Choose a folder<input type="file" id="folder" webkitdirectory multiple hidden></label>
          <label class="btn ghost small">Add a Claude pack<input type="file" id="pack" accept=".zip,.csv,application/zip,text/csv,image/*" multiple hidden></label>
        </div>
        <small style="color:var(--muted)">Claude pack: the .zip Claude makes from your photos in chat, with names and groups already filled in.</small>
      </div>
    </details>

    <div class="drop drop-desk" id="drop" tabindex="0" role="button" aria-label="Add photos">
      <h2>Drop photos here</h2>
      <p>or use the buttons below. Name a file like “barbie camper.jpg” and that name is used.</p>
    </div>

    <div class="shutter">
      <label class="gal" aria-label="Pick from gallery">${GALLERY}<input type="file" id="files" accept="image/*,video/*" multiple hidden></label>
      <label class="shoot" aria-label="Take photo"><span>${CAMERA}</span><input type="file" id="camera" accept="image/*" capture="environment" hidden></label>
      <a class="btn" id="reviewGo" href="#review">Review${done ? ' ' + done : ''}</a>
    </div>
  `;
  wire();
}

function wire() {
  $$('[data-opt="price"]', root).forEach((b) => b.onclick = () => { opts.price = Number(b.dataset.value); render(); });
  $('#otherPrice', root).onchange = (e) => { const v = parseInt(e.target.value, 10); if (v > 0) { opts.price = v; render(); } };
  $$('[data-seg]', root).forEach((b) => b.onclick = () => {
    if (b.dataset.seg === 'naming') setNamingMode(b.dataset.value);
    else opts[b.dataset.seg] = b.dataset.value;
    render();
  });
  $('#moreOpts', root).ontoggle = (e) => { moreOpen = e.target.open; };
  $('#boxSel', root).onchange = (e) => { opts.box_id = e.target.value; };
  const drop = $('#drop', root);
  for (const id of ['#files', '#camera', '#folder', '#pack']) {
    $(id, root).onchange = (e) => addFiles([...e.target.files]);
  }
  root.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  root.ondragleave = () => drop.classList.remove('over');
  root.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); };
  drop.onclick = () => $('#files', root).click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') $('#files', root).click(); };
}

// Claude packs carry, next to 001.jpg, 001-cut.png (the toy cut out) and
// 001-plate.jpg (the photo with the toy painted out).
const EXTRA = /-(cut\.png|plate\.jpg)$/i;
const isImage = (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name);
const isVideo = (f) => f.type.startsWith('video/') || /\.(mp4|mov|webm|3gp)$/i.test(f.name);

// Photos, plus any Claude pack (.zip) or labels.csv that came with them.
async function addFiles(list) {
  let files = [...list];
  let labels = new Map();
  const extras = new Map();
  notice = null;
  try {
    for (const zip of files.filter((f) => /\.zip$/i.test(f.name))) {
      for (const entry of await readZip(zip)) {
        if (/\.csv$/i.test(entry.name)) labels = new Map([...labels, ...packLabels(parseCsv(await entry.blob.text()))]);
        else if (EXTRA.test(entry.name)) extras.set(entry.name.toLowerCase(), entry.blob);
        else if (/\.(jpe?g|png|webp)$/i.test(entry.name)) {
          const type = /\.png$/i.test(entry.name) ? 'image/png' : /\.webp$/i.test(entry.name) ? 'image/webp' : 'image/jpeg';
          files.push(new File([entry.blob], entry.name, { type }));
        }
      }
    }
    for (const csv of files.filter((f) => /\.csv$/i.test(f.name))) {
      labels = new Map([...labels, ...packLabels(parseCsv(await csv.text()))]);
    }
  } catch (e) {
    notice = { bad: true, text: 'Could not open the Claude pack: ' + e.message };
  }
  for (const f of files.filter((x) => EXTRA.test(x.name))) extras.set(f.name.toLowerCase(), f);
  files = files.filter((f) => (isImage(f) || isVideo(f)) && !EXTRA.test(f.name));
  if (labels.size) {
    const missing = files.filter((f) => !labels.has(labelKey(f.name))).length;
    notice = { bad: !!missing, text: `${files.length - missing} photo${files.length - missing === 1 ? '' : 's'} named by Claude.`
      + (missing ? ` ${missing} had no line in labels.csv and will be named by the AI or left as "Unnamed toy".` : '') };
  }
  // Each job knows the one before it in this batch: a video, and (when
  // grouping) a photo, waits for it and may join the same toy.
  let prev = null;
  for (const file of files) {
    const video = isVideo(file);
    const job = {
      file,
      video,
      prev,
      group: opts.group === 'on' && !labels.size,
      thumb: video ? '' : URL.createObjectURL(file),
      state: 'waiting',
      step: 'Waiting',
      options: {
        ...opts,
        labels: labels.get(labelKey(file.name)) || null,
        cutout: extras.get(`${labelKey(file.name)}-cut.png`) || null,
        plate: extras.get(`${labelKey(file.name)}-plate.jpg`) || null,
      },
    };
    jobs.unshift(job);
    prev = job;
  }
  render();
  pump();
}

function pump() {
  while (running < PARALLEL) {
    const settled = (j) => !j || ['done', 'error'].includes(j.state);
    const job = [...jobs].reverse().find((j) => j.state === 'waiting' && (settled(j.prev) || !(j.video || j.group)));
    if (!job) break;
    running++;
    job.state = 'working';
    run(job).finally(() => { running--; pump(); });
  }
}

async function run(job) {
  try {
    if (job.video) {
      const owner = job.prev?.owner;
      if (!owner?.toy) throw new Error('Add a photo of the toy before its video.');
      job.step = 'Uploading video…';
      render();
      owner.toy = await addMedia(owner.toy, [job.file]);
      job.owner = owner;
      job.state = 'done';
      job.step = `Video added to ${owner.toy.name}`;
      render();
      return;
    }
    if (job.group) {
      job.step = 'Checking for other angles…';
      render();
      const { imageVector, similarity } = await import('./recognise.js');
      // If the recogniser cannot load, the photo just becomes its own toy.
      // A photo the recogniser cannot read just becomes its own toy.
      job.vector = await (async () => {
        const bmp = await loadBitmap(job.file);
        const small = await toJpeg(bmp, 512, 0.85);
        bmp.close?.();
        return imageVector(small, (s) => { job.step = s + '…'; render(); });
      })().catch(() => null);
      const before = job.prev && !job.prev.video ? job.prev : null;
      const owner = before?.owner;
      if (owner?.toy && job.vector && before.vector && similarity(job.vector, before.vector) >= SAME_TOY) {
        owner.toy = await addMedia(owner.toy, [job.file]);
        job.owner = owner;
        job.state = 'done';
        job.step = `Another angle of ${owner.toy.name}`;
        render();
        return;
      }
      if (job.vector) job.options = { ...job.options, vector: job.vector };
    }
    if (/\.heic$/i.test(job.file.name) && !job.file.type.includes('jpeg')) {
      throw new Error('iPhone HEIC photo: export it as JPEG (or pick it with the phone, which converts it).');
    }
    const { toy, aiError } = await addToyFromPhoto(job.file, job.options, (s) => { job.step = s + '…'; render(); });
    job.toy = toy;
    job.owner = { toy };
    job.state = 'done';
    job.step = aiError ? `Ready to review. AI could not name it: ${aiError}` : `Ready to review · ${kwacha(toy.price)}`;
  } catch (e) {
    job.state = 'error';
    job.step = 'Failed: ' + friendlyError(e);
  }
  render();
  refreshBadges();
}
