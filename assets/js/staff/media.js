// More photos and a video for one toy, shown as a gallery on the toy's shop
// page. Used on the Review page and in the Stock edit panel.
import { esc } from '../lib.js';
import { imageUrl, friendlyError } from '../db.js';
import { $, $$, toast } from './ui.js';
import { addMedia, removeMedia } from './photos.js';

export function mediaHtml(t) {
  const media = t.media || [];
  return `
    <div class="media-strip" data-media="${t.id}">
      ${media.map((m) => `
        <span class="media-thumb">
          ${m.type === 'video' ? `<video src="${esc(imageUrl(m.path))}" muted preload="metadata"></video><b aria-hidden="true">▶</b>`
            : `<img src="${esc(imageUrl(m.path))}" alt="" loading="lazy">`}
          <button type="button" data-remove-media="${esc(m.path)}" aria-label="Remove">×</button>
        </span>`).join('')}
      <label class="btn ghost small">${media.length ? 'Add more' : 'Add photos or video'}<input type="file" accept="image/*,video/*" multiple data-add-media hidden></label>
    </div>`;
}

// onChange(updatedToy) after a file is added or removed.
export function wireMedia(el, t, onChange) {
  const strip = $(`[data-media="${t.id}"]`, el);
  if (!strip) return;
  $('[data-add-media]', strip).onchange = async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    strip.insertAdjacentHTML('beforeend', '<span class="st">Uploading…</span>');
    try {
      onChange(await addMedia(t, files));
      toast(`${files.length} added`);
    } catch (err) {
      toast(friendlyError(err), true);
      onChange(t);
    }
  };
  $$('[data-remove-media]', strip).forEach((b) => b.onclick = async () => {
    try {
      onChange(await removeMedia(t, b.dataset.removeMedia));
    } catch (err) {
      toast(friendlyError(err), true);
    }
  });
}
