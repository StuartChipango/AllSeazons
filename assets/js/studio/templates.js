// Ready-made post layouts. Each maker takes what the owner typed in the
// setup step and returns pages (see render.js) that can then be changed
// freely in the editor.
import { THEMES, pickMascot } from './render.js';

let n = 0;
export const uid = () => `l${Date.now().toString(36)}${(n++).toString(36)}`;

export const FAMILIES = {
  holiday: { label: 'Holidays & seasons', hint: 'Christmas, New Year, Easter, Independence, birthdays…', mascot: 'spri', themes: ['christmas', 'xmasgreen', 'newyear', 'easter', 'zambia', 'party', 'school', 'brand'] },
  deal: { label: 'Special deal', hint: 'Discount frames for chosen toys', mascot: 'auty', themes: ['sale', 'christmas', 'party', 'pink', 'brand', 'sky', 'newyear', 'cream'] },
  ask: { label: 'Questions & games', hint: 'Q&A, This or that, quizzes, guess the toy, with the mascots', mascot: 'sammy', themes: ['pink', 'sky', 'party', 'cream', 'brand', 'sale', 'christmas', 'easter'] },
  news: { label: 'Announcement', hint: 'New stock, shop news, opening hours', mascot: 'winnie', themes: ['brand', 'cream', 'pink', 'sky', 'party', 'sale', 'christmas', 'zambia'] },
};

export const ASK_KINDS = {
  question: { label: 'Question', headline: 'Question time!', text: 'What was your favourite toy when you were little?', cta: 'Answer in the comments 👇' },
  thisorthat: { label: 'This or that', headline: 'This or that?', text: '', cta: 'Comment A or B 👇' },
  quiz: { label: 'Quiz', headline: 'Quiz time!', text: 'Which toy helps a 1 year old learn shapes?', options: ['Shape sorter', 'Toy car', 'Teddy bear'], cta: 'Comment your answer 👇' },
  guess: { label: 'Guess the toy', headline: 'Guess the toy!', text: 'Zoom in close on one part of the toy', cta: 'Guess in the comments 👇' },
  fact: { label: 'Did you know?', headline: 'Did you know?', text: 'Playing with blocks helps children learn counting, balance and patience.', cta: 'Share with a parent 💛' },
};

export const DEAL_DEFAULT = { headline: 'Special deals', line: 'This week only', big: '20%', small: 'OFF' };
export const NEWS_DEFAULT = { headline: 'New toys just arrived!', line: 'Come see them at the shop or order on WhatsApp' };

// ---------- pieces ----------

const text = (o) => ({ id: uid(), kind: 'text', s: 1, font: 'round', size: 60, maxW: 900, ...o });
const photo = (o) => ({ id: uid(), kind: 'photo', s: 1, zoom: 1, px: 0, py: 0, radius: 44, ...o });
const sticker = (o) => ({ id: uid(), kind: 'sticker', s: 1, ...o });
const badge = (o) => ({ id: uid(), kind: 'badge', s: 1, shape: 'burst', r: 150, ...o });
const price = (o) => ({ id: uid(), kind: 'price', s: 1, ...o });

const logo = (x = 140, y = 92, h = 112) => sticker({ src: 'logo', x, y, h });
const mascot = (theme, want, o) => sticker({ src: `mascot:${pickMascot(theme, want)}`, ...o });

function footer(o) {
  const bits = [o.site, o.wa ? `WhatsApp ${o.wa}` : ''].filter(Boolean);
  return text({ text: bits.join('  ·  '), x: 540, y: 1036, size: 30, maxW: 1000, color: '#1a1424', box: { fill: '#ffffff', pad: 12, pop: false, stroke: 'none' }, role: 'footer' });
}

function headline(theme, words, y = 150, size = 128) {
  return text({ text: words, x: 540, y, font: 'script', size, maxW: 940, maxLines: 2, style: 'sticker', color: THEMES[theme].head, role: 'headline' });
}

const pill = (words, x, y, size = 46, o = {}) => text({ text: words, x, y, size, maxW: 860, color: '#1a1424', box: { fill: '#ffffff' }, ...o });

// Toy name + price under a photo.
function toyBits(t, theme, y = 880) {
  const out = [];
  if (t.name) out.push(pill(t.name, 540, y, 52, { role: 'name' }));
  if (t.now) out.push(price({ x: 540, y: y + 100, old: t.old || '', now: t.now, s: 0.9 }));
  return out;
}

// One to four toy photos in a tidy layout inside the area top..bottom.
function collage(toys, top, bottom) {
  const list = toys.length ? toys.slice(0, 4) : [{}];
  const h = bottom - top;
  const mid = (top + bottom) / 2;
  if (list.length === 1) return [photo({ src: list[0].src, x: 540, y: mid, w: 820, h, tilt: -0.02 })];
  if (list.length === 2) {
    return [photo({ src: list[0].src, x: 300, y: mid, w: 450, h: Math.min(h, 560), tilt: -0.035 }),
      photo({ src: list[1].src, x: 780, y: mid + 10, w: 450, h: Math.min(h, 560), tilt: 0.035 })];
  }
  const cw = 420;
  const ch = Math.min(380, (h - 30) / 2);
  const spots = [[310, mid - ch / 2 - 12], [770, mid - ch / 2 - 12], [310, mid + ch / 2 + 12], [770, mid + ch / 2 + 12]];
  if (list.length === 3) spots[2] = [540, mid + ch / 2 + 12];
  return list.map((t, i) => photo({ src: t.src, x: spots[i][0], y: spots[i][1], w: cw, h: ch, radius: 36, tilt: [-0.02, 0.02, 0.015, -0.015][i] }));
}

// ---------- the makers ----------

function holiday(o) {
  const th = o.theme;
  const t = THEMES[th];
  const pages = [{
    theme: th,
    layers: [
      logo(540, 100, 135),
      headline(th, o.headline || t.headline, 335, 140),
      pill(o.line ?? t.line, 540, 535, 44, { maxW: 800, font: 'soft', role: 'line' }),
      mascot(th, 'spri', { x: 300, y: 790, h: 360, tilt: -0.05 }),
      mascot(th, 'winnie', { x: 790, y: 795, h: 350, flip: true, tilt: 0.05 }),
      footer(o),
    ],
  }];
  for (const toy of o.toys) {
    pages.push({
      theme: th,
      layers: [
        photo({ src: toy.src, x: 540, y: 480, w: 820, h: 620, tilt: -0.015 }),
        headline(th, t.ribbon, 110, 92),
        logo(120, 980, 90),
        ...toyBits(toy, th, 850),
        footer(o),
      ],
    });
  }
  return pages;
}

function deal(o) {
  const th = o.theme;
  const t = THEMES[th];
  const big = o.big || '20%';
  const small = o.small ?? 'OFF';
  // One toy: its own page says it all.
  const pages = o.toys.length === 1 ? [] : [{
    theme: th,
    layers: [
      ...collage(o.toys, 260, 880),
      headline(th, o.headline || DEAL_DEFAULT.headline, 130, 130),
      badge({ x: 880, y: 300, r: 140, big, small, tilt: 0.12 }),
      pill(o.line ?? DEAL_DEFAULT.line, 540, 960, 44, { role: 'when' }),
      logo(140, 1000, 90),
      footer(o),
    ],
  }];
  for (const toy of o.toys) {
    pages.push({
      theme: th,
      layers: [
        photo({ src: toy.src, x: 540, y: 470, w: 840, h: 640, tilt: -0.015 }),
        headline(th, o.headline || DEAL_DEFAULT.headline, 110, 100),
        badge({ x: 890, y: 230, r: 125, big: toy.badge || big, small: toy.badge ? '' : small, tilt: 0.12 }),
        ...toyBits(toy, th, 860),
        footer(o),
      ],
    });
  }
  return pages;
}

function ask(o) {
  const th = o.theme;
  const t = THEMES[th];
  const k = ASK_KINDS[o.kind] || ASK_KINDS.question;
  const head = headline(th, o.headline || k.headline, 120, 120);
  const cta = pill(o.cta || k.cta, 540, 965, 44, { role: 'cta' });
  const toys = o.toys;
  let layers;
  if (o.kind === 'thisorthat') {
    const [a = {}, b = {}] = toys;
    layers = [
      photo({ src: a.src, x: 290, y: 520, w: 450, h: 540, tilt: -0.03 }),
      photo({ src: b.src, x: 790, y: 530, w: 450, h: 540, tilt: 0.03 }),
      badge({ x: 540, y: 525, r: 78, shape: 'circle', big: 'OR', small: '' }),
      pill(`A${a.name ? `  ${a.name}` : ''}`, 290, 840, 40, { maxW: 420 }),
      pill(`B${b.name ? `  ${b.name}` : ''}`, 790, 840, 40, { maxW: 420 }),
      head, cta,
    ];
  } else if (o.kind === 'quiz') {
    const opts = (o.options?.length ? o.options : k.options).filter(Boolean).slice(0, 4);
    layers = [
      head,
      text({ text: o.text || k.text, x: 600, y: 330, size: 58, maxW: 720, box: { fill: '#ffffff', radius: 48, tail: 'left' }, color: '#1a1424' }),
      ...opts.map((w, i) => pill(`${'ABCD'[i]}.  ${w}`, 470, 545 + i * 112, 46, { maxW: 640, align: 'left' })),
      mascot(th, 'sammy', { x: 900, y: 700, h: 330, flip: true }),
      cta,
    ];
  } else if (o.kind === 'guess') {
    layers = [
      photo({ src: toys[0]?.src, x: 540, y: 530, w: 780, h: 640, zoom: 2.2, tilt: -0.02 }),
      head,
      mascot(th, 'auty', { x: 140, y: 820, h: 300, tilt: -0.08 }),
      cta,
    ];
  } else {
    // Question and Did you know: a mascot asking in a speech bubble.
    layers = [
      head,
      text({ text: o.text || k.text, x: 600, y: 420, size: 64, maxW: 720, box: { fill: '#ffffff', radius: 52, tail: 'left' }, color: '#1a1424', role: 'question' }),
      mascot(th, o.kind === 'fact' ? 'winnie' : 'sammy', { x: 220, y: 740, h: 420, tilt: -0.04 }),
      cta,
    ];
    if (toys[0]) layers.splice(1, 0, photo({ src: toys[0].src, x: 790, y: 770, w: 380, h: 300, radius: 32, tilt: 0.04 }));
  }
  return [{ theme: th, layers: [...layers, footer(o)] }];
}

function news(o) {
  const th = o.theme;
  const t = THEMES[th];
  const layers = [
    headline(th, o.headline || NEWS_DEFAULT.headline, 170, 130),
    ...(o.toys.length ? collage(o.toys, 320, 790) : []),
    pill(o.line ?? NEWS_DEFAULT.line, 540, o.toys.length ? 885 : 560, 46, { maxW: 820 }),
    o.toys.length ? logo(140, 985, 90) : logo(540, 760, 220),
    footer(o),
  ];
  if (!o.toys.length) layers.push(mascot(th, 'spri', { x: 140, y: 800, h: 280 }), mascot(th, 'winnie', { x: 950, y: 820, h: 260, flip: true }));
  return [{ theme: th, layers }];
}

export function makePages(family, opts) {
  const o = { toys: [], ...opts };
  const maker = { holiday, deal, ask, news }[family] || holiday;
  return maker(o);
}

// A caption to paste under the post.
export function caption(family, o) {
  const t = THEMES[o.theme] || THEMES.brand;
  const contact = [o.wa ? `📲 WhatsApp ${o.wa}` : '', o.site ? `🛒 ${o.site}` : ''].filter(Boolean).join('\n');
  const toyLines = (o.toys || []).filter((x) => x.name).map((x) => `• ${x.name}${x.now ? ` ${x.old ? `${x.old} → ` : ''}${x.now}` : ''}`).join('\n');
  let top;
  if (family === 'deal') top = `${t.emoji} ${o.headline || DEAL_DEFAULT.headline}: ${[o.big, o.small].filter(Boolean).join(' ')}! ${o.line ?? DEAL_DEFAULT.line}`.trim();
  else if (family === 'ask') {
    const k = ASK_KINDS[o.kind] || ASK_KINDS.question;
    const q = o.kind === 'quiz' ? `${o.text || k.text}\n${(o.options || k.options).filter(Boolean).map((w, i) => `${'ABCD'[i]}. ${w}`).join('\n')}` : (o.text || '');
    top = `${o.headline || k.headline} ${q}\n${o.cta || k.cta}`.trim();
  } else if (family === 'news') top = `${t.emoji} ${o.headline || NEWS_DEFAULT.headline} ${o.line ?? NEWS_DEFAULT.line}`.trim();
  else top = `${t.emoji} ${o.headline || t.headline}! ${o.line ?? t.line}`.trim();
  return [top, toyLines, 'Quality toys at prices every family can afford.', contact, '#AllSeazons #Lusaka #Zambia #Toys'].filter(Boolean).join('\n\n');
}
