# Setting up the All Seazons store

About 30 minutes, once. You need: an email address, a card for the Anthropic account (AI labelling costs a few cents per photo), and access to the GitHub repository.

## 1. Create the database (Supabase, free)

1. Go to [supabase.com](https://supabase.com), sign up, and click **New project**.
   - Name: `allseazons`
   - Database password: make a strong one and save it somewhere safe.
   - Region: the closest one offered to Zambia.
2. When the project is ready, open **SQL Editor**, click **New query**, paste everything from [`supabase/schema-paste.sql`](supabase/schema-paste.sql) (the same rules as `schema.sql` with comments and spacing removed, so copying cannot break it) and click **Run**. You should see "Success".
3. Create your staff login: **Authentication → Users → Add user → Create new user**. Enter your email and a password, and tick **Auto Confirm User**.
4. Put yourself on the staff list: back in **SQL Editor**, run this with your own email:
   ```sql
   insert into staff (email, name, roles) values ('you@example.com', 'Your name', '{owner}');
   ```
5. Stop strangers from signing up: **Authentication → Sign In / Providers**, turn off **Allow new users to sign up**.
6. Everyone else is added from the staff app: **Settings → Team → Add a person**. Give them a short sign-in name (no email needed), a password, and their jobs: **Owner** (everything), **Stock** (photos, review, stock, boxes) or **Sales** (orders, shop sales, receipts). Switching someone off signs them out on every phone. **Settings → Who did what** shows every approval, price change, sale and order update with the person's name.
6. Click **Connect** at the top of the project (or open **Project Settings → API**) and copy two values: the **Project URL** and the **anon / publishable key**. Paste them into [`assets/js/config.js`](assets/js/config.js). (The anon key is meant to be public; the database rules protect your data.)

## 2. Naming toys

By default the staff app names toys **on the device** (Add toys → Naming → On this device): a small picture-matching model runs in the browser and picks the toy type (Teddy Bear, Toy Phone, Musical Book…), its main colour, category and age group. No key and no service to set up; the model (about 55 MB) downloads the first time and the browser keeps it. The toy types live in `assets/js/staff/recognise.js`.

### Optional: online AI naming (better with brands and characters)

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey), sign in with a Google account and click **Create API key**. Copy it. The free tier needs no card; it allows a few photos a minute, and the staff app waits and retries when you upload many at once.
2. In Supabase open **Edge Functions → Deploy a new function → Via Editor**. Name it `label-toy`, replace the sample code with everything from [`supabase/functions/label-toy/index.ts`](supabase/functions/label-toy/index.ts) and click **Deploy**.
3. Open **Edge Functions → Secrets** and add a secret named `GEMINI_API_KEY` with the key you copied.

To use Claude instead (paid, better with brand names), add the secret `ANTHROPIC_API_KEY` with a key from [console.anthropic.com](https://console.anthropic.com) and leave `GEMINI_API_KEY` out. `LABEL_MODEL` picks a different model for either.

If labelling is not set up yet, uploads still work: toys arrive on the Review page as "Unnamed toy" for you to name.

### Or name the photos with Claude in chat instead

This uses your normal Claude account, so there is nothing to pay for per photo.

1. In your Claude project, send the toy photos in a chat and ask Claude to "make a Claude pack" (say the price if the whole batch has one).
2. Claude looks at each photo, names it, picks boys/girls/neutral, used/new, category and age, and sends back a `.zip` file (the photos plus `labels.csv`).
3. Download the `.zip`. In the staff app open **Add toys → Add a Claude pack** and pick it.
4. The frames are drawn and the toys land on **Review**, already named. Fix anything wrong and **Approve**.

You can also drop photos together with a `labels.csv` (columns `file,name,brand,audience,condition,category,age_range,description,price`). `price` can be left blank to use the price picked on the page. Claude makes packs with [`tools/make_pack.py`](tools/make_pack.py).

## 3. Put the website online (GitHub Pages)

The site is plain files, so GitHub Pages hosts it for free.

1. The files go in the `stuartchipango/AllSeazons` repository (this replaces the old Studio app).
2. In the repository open **Settings → Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. The shop is then at `https://stuartchipango.github.io/AllSeazons/` and the staff app at `https://stuartchipango.github.io/AllSeazons/staff/`.

## 4. Fill in your shop details

Sign in at the staff app and open **Settings**:

- **WhatsApp Business number**: orders are sent here.
- **Price tiers**: K50, K75, K100… whatever you use.
- **Towns**: the out-of-town list with each courier and its small, medium and large fee. A blank fee shows "fee confirmed on WhatsApp".
- **Notes** for pickup, Yango and courier, and the banner at the top of the shop.
- **Staff**: add other staff here after creating their login (step 1.3).

## 5. Bring over the old stock (optional)

In the old Google Sheet, **File → Download → CSV** for the Toys tab. In the staff app open **Stock → Import CSV**. Available toys arrive on the Review page; add a photo to each and approve.

## 6. See where website visitors come from

Free, built in, no extra account. After running the latest `schema-paste.sql`, the shop counts each visit and where it came from: Facebook, WhatsApp, Instagram, TikTok, Google and other searches, posters and QR codes, other websites, or "Direct or unknown". It also counts what visitors did next: looked at a toy, tapped WhatsApp, placed an order (with the order's real total).

- Open it from the **Website visitors today** tile on Home (owner only).
- **Use tracked links.** WhatsApp chats and status hide where a visitor came from, so they show as "Direct". On the Website visitors page, **Make a tracked link** gives links like `https://allseazons.shop/?src=wa-status` (WhatsApp status), `?src=fb` (Facebook posts), `?src=ig-bio` (Instagram bio), `?src=qr` (posters and the QR code at the shop). Add a promotion name to compare offers: `?src=fb&c=christmas`.
- Phones that sign in to the staff app are not counted, so your own checking does not show up. Change this under "What do these mean?" on that page.
- No names or numbers are stored. Rows older than 400 days are removed automatically.

## Daily use

1. Take photos on your phone.
2. Staff app → **Add toys**: pick the price, choose the photos (from the phone, or drag a folder on the laptop).
3. **Review**: fix anything the AI got wrong, then **Approve all**.
4. Customers order on WhatsApp. In **Orders**: Confirm → Mark paid → Print sticker → Packed → Sent.
5. Walk-in sale: **Stock**, tick the toys, **Sell in shop**.

Tip: on your phone, open the staff app and choose **Add to Home Screen** so it opens like an app.
