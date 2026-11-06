// Names a toy from its photo right here in the browser: no key, no paid
// service. A small picture-matching model (MobileCLIP, about 55 MB, saved by
// the browser after the first time) compares the photo with a list of toy
// types below and picks the closest one, plus its main colour. Staff check
// every name on the Review page, so a plain "Pink Toy Phone" is fine.

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MODELS = ['Xenova/mobileclip_s0', 'Xenova/clip-vit-base-patch32'];

// name, category, age, audience, prompts. Category names match the shop's.
const SOFT = 'Soft Toys', BABY = 'Baby & Toddler', DOLLS = 'Dolls & Accessories', CARS = 'Cars & Vehicles',
  BLOCKS = 'Building & Blocks', PUZ = 'Puzzles & Games', FIG = 'Action Figures', PRET = 'Pretend Play',
  LEARN = 'Learning Toys', OUT = 'Outdoor & Sports', BOOKS = 'Books', OTHER = 'Other';
export const TOY_TYPES = [
  ['Teddy Bear', SOFT, '0-2', 'neutral', ['a teddy bear', 'a plush bear soft toy']],
  ['Bunny Plushie', SOFT, '0-2', 'neutral', ['a plush bunny rabbit soft toy']],
  ['Dog Plushie', SOFT, '0-2', 'neutral', ['a plush dog soft toy', 'a stuffed puppy toy']],
  ['Cat Plushie', SOFT, '0-2', 'neutral', ['a plush cat soft toy']],
  ['Elephant Plushie', SOFT, '0-2', 'neutral', ['a plush elephant soft toy']],
  ['Unicorn Plushie', SOFT, '3-5', 'girls', ['a plush unicorn soft toy']],
  ['Monkey Plushie', SOFT, '0-2', 'neutral', ['a plush monkey soft toy']],
  ['Lion Plushie', SOFT, '0-2', 'neutral', ['a plush lion soft toy']],
  ['Character Plushie', SOFT, '3-5', 'neutral', ['a plush cartoon character soft toy', 'a stuffed animal toy']],
  ['Baby Doll', DOLLS, '3-5', 'girls', ['a baby doll toy']],
  ['Fashion Doll', DOLLS, '6-8', 'girls', ['a barbie fashion doll', 'a plastic fashion doll with long hair']],
  ['Rag Doll', DOLLS, '3-5', 'girls', ['a soft rag doll']],
  ['Doll House', DOLLS, '3-5', 'girls', ['a toy doll house']],
  ['Doll Pram', DOLLS, '3-5', 'girls', ['a toy pram for dolls', 'a doll stroller toy']],
  ['Action Figure', FIG, '6-8', 'boys', ['a plastic action figure toy', 'a soldier action figure']],
  ['Superhero Figure', FIG, '3-5', 'boys', ['a superhero action figure toy']],
  ['Toy Figures Set', FIG, '3-5', 'neutral', ['a set of small plastic toy figures', 'cartoon character figurines']],
  ['Dinosaur Toy', FIG, '3-5', 'boys', ['a toy dinosaur']],
  ['Toy Animals', LEARN, '3-5', 'neutral', ['plastic toy farm animals', 'a toy animal figure']],
  ['Toy Car', CARS, '3-5', 'boys', ['a toy car', 'a die-cast model car']],
  ['Race Car', CARS, '3-5', 'boys', ['a toy race car']],
  ['Toy Truck', CARS, '3-5', 'boys', ['a toy truck', 'a toy dump truck']],
  ['Remote Control Car', CARS, '6-8', 'boys', ['a remote control car with a controller']],
  ['Toy Train', CARS, '3-5', 'boys', ['a toy train', 'a toy train set with tracks']],
  ['Toy Plane', CARS, '3-5', 'boys', ['a toy airplane']],
  ['Toy Helicopter', CARS, '3-5', 'boys', ['a toy helicopter']],
  ['Toy Tractor', CARS, '3-5', 'boys', ['a toy tractor']],
  ['Building Blocks', BLOCKS, '3-5', 'neutral', ['toy building blocks', 'lego bricks']],
  ['Wooden Blocks', BLOCKS, '0-2', 'neutral', ['wooden toy blocks']],
  ['Stacking Rings', BABY, '0-2', 'neutral', ['a baby stacking ring toy', 'stacking cups for babies']],
  ['Shape Sorter', BABY, '0-2', 'neutral', ['a shape sorter toy']],
  ['Baby Rattle', BABY, '0-2', 'neutral', ['a baby rattle', 'a baby teether toy']],
  ['Pram Toy', BABY, '0-2', 'neutral', ['a baby pram toy bar with hanging toys', 'a baby activity toy to hang on a pram']],
  ['Baby Activity Toy', BABY, '0-2', 'neutral', ['a colourful baby activity toy with buttons', 'a baby activity centre']],
  ['Play Mat', BABY, '0-2', 'neutral', ['a baby play mat with a play gym']],
  ['Baby Walker', BABY, '0-2', 'neutral', ['a baby push walker toy']],
  ['Bath Toy', BABY, '0-2', 'neutral', ['a rubber duck bath toy', 'baby bath toys']],
  ['Jigsaw Puzzle', PUZ, '6-8', 'neutral', ['a jigsaw puzzle', 'a box of jigsaw puzzle pieces']],
  ['Wooden Puzzle', PUZ, '3-5', 'neutral', ['a wooden peg puzzle for toddlers']],
  ['Board Game', PUZ, '6-8', 'neutral', ['a board game box', 'a board game']],
  ['Card Game', PUZ, '6-8', 'neutral', ['a pack of playing cards game']],
  ['Toy Phone', PRET, '0-2', 'neutral', ['a toy telephone for kids', 'a toy mobile phone']],
  ['Toy Kitchen Set', PRET, '3-5', 'neutral', ['a toy kitchen with pots and pans', 'toy cooking set']],
  ['Toy Food Set', PRET, '3-5', 'neutral', ['plastic toy food', 'toy fruit and vegetables']],
  ['Tea Set', PRET, '3-5', 'girls', ['a toy tea set with cups and teapot']],
  ['Doctor Kit', PRET, '3-5', 'neutral', ['a toy doctor kit with stethoscope']],
  ['Tool Set', PRET, '3-5', 'boys', ['a toy tool set with hammer and screwdriver']],
  ['Toy Cash Register', PRET, '3-5', 'neutral', ['a toy cash register']],
  ['Toy Laptop', LEARN, '3-5', 'neutral', ['a kids learning laptop toy']],
  ['Musical Keyboard', LEARN, '3-5', 'neutral', ['a toy piano keyboard']],
  ['Toy Guitar', LEARN, '3-5', 'neutral', ['a toy guitar']],
  ['Toy Saxophone', LEARN, '3-5', 'neutral', ['a toy saxophone', 'a toy trumpet']],
  ['Xylophone', LEARN, '0-2', 'neutral', ['a toy xylophone']],
  ['Toy Drum', LEARN, '0-2', 'neutral', ['a toy drum']],
  ['Musical Book', BOOKS, '0-2', 'neutral', ['an interactive musical book toy for babies with buttons']],
  ['Picture Book', BOOKS, '3-5', 'neutral', ['a children\'s picture book']],
  ['Story Books', BOOKS, '6-8', 'neutral', ['a stack of children\'s story books']],
  ['Art Set', LEARN, '6-8', 'neutral', ['a kids art set with crayons and markers', 'colouring pencils']],
  ['Play Dough Set', LEARN, '3-5', 'neutral', ['play dough tubs and moulds']],
  ['Learning Toy', LEARN, '3-5', 'neutral', ['an educational electronic learning toy']],
  ['Football', OUT, '6-8', 'boys', ['a football soccer ball']],
  ['Ball', OUT, '3-5', 'neutral', ['a toy ball', 'a bouncy ball']],
  ['Water Gun', OUT, '6-8', 'boys', ['a toy water gun']],
  ['Toy Gun', OUT, '6-8', 'boys', ['a toy gun blaster']],
  ['Ride-On Toy', OUT, '0-2', 'neutral', ['a ride-on toy for toddlers']],
  ['Kids Bike', OUT, '6-8', 'neutral', ['a children\'s bicycle', 'a tricycle']],
  ['Scooter', OUT, '6-8', 'neutral', ['a kids scooter']],
  ['Pencil Case', OTHER, '6-8', 'neutral', ['a school pencil case tin']],
  ['Toy Set', OTHER, '3-5', 'neutral', ['a set of assorted toys']],
].map(([name, category, age, audience, prompts]) => ({ name, category, age, audience, prompts }));

const COLOURS = ['Red', 'Blue', 'Green', 'Yellow', 'Pink', 'Purple', 'Orange', 'Brown', 'Black', 'White', 'Grey'];
// Types whose names read badly with a colour in front.
const NO_COLOUR = new Set(['Building Blocks', 'Wooden Blocks', 'Stacking Rings', 'Jigsaw Puzzle', 'Wooden Puzzle', 'Board Game',
  'Card Game', 'Toy Food Set', 'Picture Book', 'Story Books', 'Art Set', 'Play Dough Set', 'Toy Set', 'Toy Figures Set', 'Toy Animals', 'Football']);

let ready = null;

const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const norm = (v) => { const n = Math.sqrt(dot(v, v)) || 1; return v.map((x) => x / n); };
const mean = (vs) => norm(vs[0].map((_, i) => vs.reduce((s, v) => s + v[i], 0) / vs.length));
function softmax(xs) {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

function storedText(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function storeText(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full or blocked: just recompute */ }
}

async function load(onStep) {
  const lib = await import(LIB);
  lib.env.allowLocalModels = false;
  let lastError;
  for (const id of MODELS) {
    try {
      onStep('Getting the toy recogniser ready (first time only, about a minute)');
      const [processor, vision] = await Promise.all([
        lib.AutoProcessor.from_pretrained(id),
        lib.CLIPVisionModelWithProjection.from_pretrained(id),
      ]);
      // The toy-type list as numbers, worked out once and kept.
      const prompts = [...TOY_TYPES.flatMap((t) => t.prompts.map((p) => `a photo of ${p}`)), ...COLOURS.map((c) => `a photo of a ${c.toLowerCase()} toy`)];
      const key = `toy-types:${id}:${prompts.length}:${prompts.join('|').length}`;
      let embeds = storedText(key);
      if (!embeds) {
        const [tokenizer, textModel] = await Promise.all([
          lib.AutoTokenizer.from_pretrained(id),
          lib.CLIPTextModelWithProjection.from_pretrained(id),
        ]);
        const { text_embeds } = await textModel(tokenizer(prompts, { padding: 'max_length', truncation: true }));
        embeds = text_embeds.tolist().map(norm);
        storeText(key, embeds);
      }
      let i = 0;
      const types = TOY_TYPES.map((t) => ({ ...t, vec: mean(t.prompts.map(() => embeds[i++])) }));
      const colours = COLOURS.map((c) => ({ name: c, vec: embeds[i++] }));
      return { lib, processor, vision, types, colours };
    } catch (e) {
      lastError = e;
    }
  }
  ready = null;
  throw new Error(`The toy recogniser could not load (${lastError?.message || 'no connection'}). Check the internet and try again.`);
}

// image: a JPEG/PNG Blob. Returns labels like the online AI's.
export async function recogniseToy(blob, onStep = () => {}) {
  if (!ready) ready = load(onStep);
  const { lib, processor, vision, types, colours } = await ready;
  onStep('Recognising the toy');
  const image = await lib.RawImage.fromBlob(blob);
  const { image_embeds } = await vision(await processor(image));
  const img = norm(image_embeds.tolist()[0]);

  const typeProbs = softmax(types.map((t) => 100 * dot(img, t.vec)));
  const order = typeProbs.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]);
  const [best, bestIdx] = order[0];
  const type = types[bestIdx];
  const colourProbs = softmax(colours.map((c) => 100 * dot(img, c.vec)));
  const ci = colourProbs.indexOf(Math.max(...colourProbs));
  const colour = colourProbs[ci] > 0.35 && !NO_COLOUR.has(type.name) ? colours[ci].name : '';

  // Pink and purple toys that are not baby toys usually sell as girls' toys.
  let audience = type.audience;
  if (audience === 'neutral' && ['Pink', 'Purple'].includes(colour) && type.category !== 'Baby & Toddler') audience = 'girls';

  const name = colour ? `${colour} ${type.name}` : type.name;
  return {
    name,
    tagline: '',
    brand: '',
    audience,
    condition: 'used',
    category: type.category,
    age_range: type.age,
    description: `A fun ${name.toLowerCase()} for ${type.age.replace('9+', '9 and up')} year olds.`,
    confidence: best > 0.5 ? 'high' : best > 0.25 ? 'medium' : 'low',
    // What else it might be, shown to staff when unsure.
    alternatives: order.slice(1, 3).map(([, i]) => types[i].name),
    source: 'device',
  };
}
