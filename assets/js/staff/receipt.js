// Hand in a receipt: anyone on staff can photograph what they bought for
// the shop. A director checks it in the Books.
import { can } from './app.js';
import { $, keepFiles } from './ui.js';
import { enterReceipts, openEntry, useBooksCss } from './books-form.js';

export async function show(main) {
  if (can('owner')) { location.hash = '#books'; return; }
  useBooksCss();
  main.innerHTML = `
    <div class="page-head"><h1>Hand in a receipt</h1></div>
    <p class="lead">Bought something for the shop? Take a photo of the receipt. The phone reads it, you check the amount, and a director puts it in the books.</p>
    <div class="bk-add">
      <label class="btn go"><input type="file" accept="image/*" capture="environment" hidden id="rcSnap">Snap a receipt</label>
      <label class="btn ghost"><input type="file" accept="image/*,application/pdf" multiple hidden id="rcPick">From gallery or PDF</label>
      <button type="button" class="btn ghost" id="rcHand">No receipt? Type it</button>
    </div>
    <p class="sub" id="rcDone"></p>`;
  let total = 0;
  const done = (n) => { total += n; $('#rcDone', main).textContent = total ? `${total} handed in. Thank you!` : ''; };
  for (const id of ['#rcSnap', '#rcPick']) {
    $(id, main).onchange = async (e) => {
      if (!e.target.files.length) return;
      const files = await keepFiles(e.target.files);
      e.target.value = '';
      done(await enterReceipts(files));
    };
  }
  $('#rcSnap', main).addEventListener('click', () => import('./receipt-reader.js').then((r) => r.warmUp()), { once: true });
  $('#rcHand', main).onclick = async () => { if (await openEntry({ kind: 'expense' }) === 'saved') done(1); };
}
