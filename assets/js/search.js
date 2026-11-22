// Forgiving toy search, shared by the shop and the staff app.
//
// People rarely type the exact name on the tag, so a search word also finds:
// - plurals and small spelling slips ("cars", "dinasor", "teddie"),
// - the start of a word ("dino", "heli") and words inside long ones ("bear" in "teddybear"),
// - words that mean the same ("plushie" = "soft toy", "lorry" = "truck"),
// - related toys, ranked lower ("vehicle" finds cars, trucks and trains; "teddy" finds plushies).
// Best matches come first. If nothing has every word, toys with some of the words show instead.
//
// It also wires search boxes so typing never reloads anything: the search runs
// when the person presses Search / Enter, or taps out of the box.

// Words that add nothing to a toy search.
const STOP = new Set(['a', 'an', 'the', 'for', 'and', 'with', 'of', 'in', 'to', 'my', 'toy', 'toys', 'kid', 'kids', 'child', 'children', 'please', 'want', 'some', 'any']);

// Words that mean the same thing (each finds the others).
const SAME = [
  ['teddy', 'teddybear'], ['plush', 'plushie', 'plushy', 'soft', 'stuffed', 'cuddly', 'snuggly'],
  ['car', 'auto', 'motorcar'], ['truck', 'lorry'], ['plane', 'airplane', 'aeroplane', 'aircraft', 'jet'],
  ['bike', 'bicycle', 'cycle', 'tricycle'], ['motorbike', 'motorcycle'], ['boat', 'ship'],
  ['rc', 'remote', 'radio'], ['doll', 'dolly'], ['dollhouse', 'dollshouse'], ['pram', 'stroller', 'buggy', 'pushchair'],
  ['block', 'brick', 'lego', 'duplo', 'megablok', 'megabloks'], ['puzzle', 'jigsaw'],
  ['dinosaur', 'dino', 'trex', 'rex'], ['dog', 'puppy', 'doggy'], ['cat', 'kitten', 'kitty'], ['bunny', 'rabbit'],
  ['horse', 'pony'], ['football', 'soccer'], ['phone', 'telephone', 'cellphone'],
  ['kitchen', 'cooking', 'cook', 'chef'], ['figure', 'figurine'], ['book', 'story', 'storybook'],
  ['baby', 'infant', 'newborn'], ['toddler', 'tot'], ['learn', 'learning', 'educational', 'education'],
  ['keyboard', 'piano'], ['gun', 'blaster', 'nerf', 'pistol'], ['makeup', 'vanity', 'beauty'],
  ['costume', 'dressup', 'outfit'], ['ball', 'balls'], ['laptop', 'computer'], ['scooter', 'kickboard'],
  ['playdough', 'playdoh', 'dough', 'clay', 'plasticine'], ['crayon', 'marker', 'colouring', 'coloring', 'drawing'],
  ['girl', 'girls', 'female'], ['boy', 'boys', 'male'], ['unicorn', 'unicorns'], ['tea', 'teaset'],
  ['used', 'secondhand', 'preloved', 'thrift'], ['new', 'brandnew', 'boxed'],
];

// Wider families: the first word finds the others (ranked lower), and each of
// the others finds the first.
const FAMILY = [
  ['vehicle', 'car', 'truck', 'bus', 'van', 'jeep', 'taxi', 'tractor', 'digger', 'excavator', 'bulldozer', 'crane', 'train', 'plane', 'helicopter', 'boat', 'motorbike', 'bike', 'race', 'racing', 'fire', 'police', 'ambulance', 'wheel'],
  ['car', 'race', 'racing', 'jeep', 'taxi', 'police', 'wheel', 'hotwheel', 'vehicle'],
  ['truck', 'tractor', 'digger', 'excavator', 'bulldozer', 'crane', 'dumper', 'tipper', 'fire'],
  ['teddy', 'bear', 'plush', 'soft'],
  ['plush', 'teddy', 'bear', 'bunny', 'unicorn', 'elephant', 'monkey', 'lion', 'dog', 'cat'],
  ['animal', 'dog', 'cat', 'lion', 'elephant', 'monkey', 'horse', 'cow', 'pig', 'sheep', 'farm', 'zoo', 'dinosaur', 'bunny', 'unicorn', 'giraffe', 'zebra', 'tiger', 'bear', 'duck', 'bird', 'fish', 'shark'],
  ['doll', 'barbie', 'princess', 'dollhouse', 'pram', 'fashion'],
  ['superhero', 'spiderman', 'batman', 'superman', 'hulk', 'avenger', 'marvel', 'ironman', 'captain', 'figure'],
  ['figure', 'action', 'superhero', 'soldier', 'dinosaur'],
  ['game', 'puzzle', 'board', 'card', 'chess', 'ludo', 'domino'],
  ['building', 'block', 'construction'],
  ['music', 'musical', 'instrument', 'keyboard', 'drum', 'guitar', 'xylophone', 'saxophone', 'trumpet', 'microphone'],
  ['baby', 'rattle', 'teether', 'stacking', 'sorter', 'walker', 'bath', 'playmat', 'mobile'],
  ['pretend', 'kitchen', 'tea', 'food', 'doctor', 'tool', 'phone', 'register', 'shop'],
  ['outdoor', 'ball', 'bike', 'scooter', 'gun', 'ride', 'sport', 'football'],
  ['learn', 'alphabet', 'abc', 'number', 'counting', 'laptop', 'book', 'shape', 'colour', 'art'],
  ['art', 'crayon', 'paint', 'playdough', 'pencil', 'craft'],
];

// Lower case, no accents, plurals made single ("puppies" -> "puppy", "boxes" -> "box").
export function stem(word) {
  let w = String(word || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  if (/^\d+$/.test(w)) return String(Number(w)); // "0012" and "12" are the same code
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 4 && /(ss|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('ie')) w = w.slice(0, -2) + 'y'; // plushie = plushy, barbie = barby
  return w;
}

export function words(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9À-ɏ]+/).map(stem).filter(Boolean);
}

// Joined words too, so "teddy bear" also matches "teddybear" and "play dough" matches "playdough".
function withPairs(list) {
  const out = [...list];
  for (let i = 0; i + 1 < list.length; i++) out.push(list[i] + list[i + 1]);
  return out;
}

const sameOf = new Map();
for (const group of SAME) {
  const g = [...new Set(group.map(stem))];
  for (const w of g) sameOf.set(w, [...new Set([...(sameOf.get(w) || []), ...g.filter((x) => x !== w)])]);
}
const familyOf = new Map();
const addFamily = (w, x) => { if (w !== x) familyOf.set(w, [...new Set([...(familyOf.get(w) || []), x])]); };
for (const group of FAMILY) {
  const [head, ...rest] = group.map(stem);
  for (const x of rest) { addFamily(head, x); addFamily(x, head); }
}
const DICTIONARY = [...new Set([...sameOf.keys(), ...familyOf.keys()])];
const KNOWN = new Set(DICTIONARY);

// Spelling slips allowed: none for short words, 1 from 4 letters, 2 from 7.
const slips = (n) => (n >= 7 ? 2 : n >= 4 ? 1 : 0);

// Edit distance (with swapped letters counting as one), giving up past `max`.
export function distance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

// How well one search word fits one word on the toy (0 = not at all).
function fit(q, w, typos) {
  if (q === w) return 1;
  if (/^\d+$/.test(q)) return 0; // numbers (codes, ages) must be exact
  // "dino" -> "dinosaur". A short whole word ("car", "cat") does not count
  // as the start of a longer one ("card", "caterpillar").
  if (q.length >= 4 && w.startsWith(q)) return 0.9;
  if (q.length >= 2 && w.startsWith(q) && !KNOWN.has(q)) return 0.6;
  if (q.length >= 4 && w.includes(q)) return 0.75; // "bear" in "teddybear"
  if (w.length >= 4 && q.startsWith(w) && w.length >= q.length - 3) return 0.7; // "teddys" -> "teddy"
  if (typos) {
    const max = slips(Math.min(q.length, w.length));
    // Short words must start with the same letter ("ball" is not "wall").
    if (max && (q.length >= 6 || q[0] === w[0])) {
      if (distance(q, w, max) <= max) return q.length >= 6 ? 0.75 : 0.6;
      // A slip in the part typed so far: "dinasa" -> "dinosaur".
      if (q.length >= 5 && w.length > q.length && distance(q, w.slice(0, q.length), 1) <= 1) return 0.65;
    }
  }
  return 0;
}

// Every way to read one search word, with how much each counts.
const expandCache = new Map();
function expand(q) {
  if (expandCache.has(q)) return expandCache.get(q);
  const terms = new Map([[q, { weight: 1, typos: true }]]);
  const add = (t, weight) => { if (!terms.has(t) || terms.get(t).weight < weight) terms.set(t, { weight, typos: false }); };
  // The word as typed, and dictionary words it is probably a slip of.
  const bases = [[q, 1]];
  for (const d of KNOWN.has(q) ? [] : DICTIONARY) {
    const max = slips(Math.min(q.length, d.length));
    if (max && distance(q, d, max) <= max) bases.push([d, 0.8]);
  }
  for (const [b, w] of bases) {
    add(b, w);
    for (const s of sameOf.get(b) || []) add(s, w * 0.9);
    for (const f of familyOf.get(b) || []) add(f, w * 0.5);
  }
  const list = [...terms].map(([term, v]) => ({ term, ...v }));
  expandCache.set(q, list);
  return list;
}

// What a toy can be found by. Name counts most, then brand, then type.
function fields(t) {
  const aud = t.audience === 'boys' ? 'boy' : t.audience === 'girls' ? 'girl' : t.audience === 'neutral' ? 'boy girl' : '';
  return [
    [withPairs(words(t.name)), 1],
    [words(`${t.code || ''} ${t.legacy_id || ''}`), 1],
    [withPairs(words(t.brand)), 0.9],
    [withPairs(words(t.tagline)), 0.8],
    [withPairs(words(t.category)), 0.8],
    [words(`${aud} ${t.condition || ''}`), 0.6],
  ];
}
const fieldCache = new WeakMap();
function fieldsOf(t) {
  const key = `${t.name}|${t.code}|${t.brand}|${t.tagline}|${t.category}|${t.audience}|${t.condition}|${t.legacy_id}`;
  const hit = fieldCache.get(t);
  if (hit && hit.key === key) return hit.f;
  const f = fields(t);
  fieldCache.set(t, { key, f });
  return f;
}

// The search words that matter, plus joined pairs ("teddy bear" -> "teddybear").
export function queryWords(query) {
  const all = words(query);
  const kept = all.filter((w) => !STOP.has(w));
  return kept.length ? kept : all;
}

// 0..1 for how well the toy fits one search word.
function wordScore(t, q) {
  let best = 0;
  for (const { term, weight, typos } of expand(q)) {
    if (weight <= best) continue;
    for (const [list, fw] of fieldsOf(t)) {
      if (weight * fw <= best) continue;
      for (const w of list) {
        const s = fit(term, w, typos) * weight * fw;
        if (s > best) best = s;
      }
    }
  }
  return best;
}

const MIN = 0.3;

// Score one toy against a search (0 = no match). Exposed for filters that
// only need yes or no.
export function scoreToy(t, query) {
  const qs = typeof query === 'string' ? queryWords(query) : query;
  if (!qs.length) return 1;
  let total = 0;
  for (const q of qs) {
    const s = wordScore(t, q);
    if (s < MIN) return 0;
    total += s;
  }
  return total / qs.length;
}

// Search a list. Returns { toys, close }: toys best first; close is true when
// no toy had every word, so these are the nearest ones instead.
export function searchToys(list, query) {
  const qs = queryWords(query);
  if (!qs.length) return { toys: list, close: false };
  const scored = [];
  for (const t of list) {
    const s = scoreToy(t, qs);
    if (s > 0) scored.push([s, t]);
  }
  if (!scored.length && qs.length > 1) {
    // Nothing has every word: show toys with the most words instead.
    for (const t of list) {
      let hits = 0, sum = 0;
      for (const q of qs) { const s = wordScore(t, q); if (s >= MIN) { hits++; sum += s; } }
      if (hits) scored.push([hits + sum / qs.length, t]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    return { toys: scored.map((x) => x[1]), close: true };
  }
  // Stable: equal scores keep the list's own order.
  scored.sort((a, b) => b[0] - a[0]);
  return { toys: scored.map((x) => x[1]), close: false };
}

// Wire a search box so it never reloads while someone types. `run(text)` is
// called when they press Search / Enter, tap the ✕, or tap out of the box,
// and only if the text changed since the last run.
export function wireSearchBox(input, run, { button } = {}) {
  if (!input) return;
  input.setAttribute('enterkeyhint', 'search');
  let last = input.value.trim();
  const go = (force = false) => {
    const v = input.value.trim();
    if (!force && v === last) return;
    last = v;
    run(v);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      go(true);
      input.blur(); // hide the phone keyboard so the results show
    }
  });
  input.addEventListener('change', () => go());
  input.addEventListener('blur', () => go());
  // The ✕ inside a search box empties it: show everything again.
  input.addEventListener('search', () => { if (!input.value) go(); });
  input.addEventListener('input', () => { if (!input.value && document.activeElement !== input) go(); });
  if (button) button.addEventListener('click', (e) => { e.preventDefault(); go(true); input.blur(); });
  return { set(v) { input.value = v; last = v.trim(); } };
}
