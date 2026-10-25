# All Seazons Play: online shop and staff app

A toy shop for pre-loved and new toys in Zambia.

- **Shop** (`/`): live stock, specials and sold toys, filters for boys/girls/neutral, used/new, price and age. Checkout holds the toys and opens WhatsApp with a labelled order message and a link to the order's pictures (`order.html`).
- **Staff app** (`/staff/`): add toys from photos (AI names them and the frame is drawn automatically), review and approve, stock, orders with parcel stickers, walk-in sales, boxes and cost per toy, settings.
- **Database**: Supabase (Postgres, sign-in, photo storage, live updates). All stock rules live in [`supabase/schema.sql`](supabase/schema.sql).
- **AI labelling**: a Supabase Edge Function calling Claude ([`supabase/functions/label-toy`](supabase/functions/label-toy/index.ts)).

No build step: the site is static files, hosted on GitHub Pages. Setup steps for the owner are in [SETUP.md](SETUP.md).

## Layout

```
index.html, order.html        shop and public order page
staff/                        staff app and sticker printing
assets/js/lib.js              shared helpers (prices, WhatsApp message, CSV)
assets/js/frame.js            draws the boys/girls/neutral frame and USED/NEW tag
assets/js/shop.js             shop
assets/js/staff/*.js          staff app pages
assets/vendor/supabase.js     supabase-js 2.45.4, bundled
supabase/schema.sql           tables, stock functions, security rules, storage
supabase/functions/label-toy  AI labelling function
tests/                        unit, database and end-to-end tests
```

## Run it locally

Needs Node 20+, PostgreSQL 16 and the [PostgREST](https://postgrest.org) binary. The harness runs a real database and PostgREST, with small fakes for sign-in, storage and the AI function.

```sh
npm install
PGURL=postgres://postgres@localhost:5432/postgres PGRST_BIN=/path/to/postgrest npm run dev
# Shop:  http://localhost:8787/
# Staff: http://localhost:8787/staff/   owner@allseazons.test / test-password
```

## Tests

```sh
node --test tests/lib.test.mjs                 # helpers
PGURL=... node --test tests/db.test.mjs        # stock rules and security
PGURL=... PGRST_BIN=... node --test tests/e2e.test.mjs   # full flow in Chromium (needs Playwright)
```
