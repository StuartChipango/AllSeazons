# Setting up the All Seazons store

About 30 minutes, once. You need: an email address, a card for the Anthropic account (AI labelling costs a few cents per photo), and access to the GitHub repository.

## 1. Create the database (Supabase, free)

1. Go to [supabase.com](https://supabase.com), sign up, and click **New project**.
   - Name: `allseazons`
   - Database password: make a strong one and save it somewhere safe.
   - Region: the closest one offered to Zambia.
2. When the project is ready, open **SQL Editor**, click **New query**, paste everything from [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. You should see "Success".
3. Create your staff login: **Authentication → Users → Add user → Create new user**. Enter your email and a password, and tick **Auto Confirm User**.
4. Put yourself on the staff list: back in **SQL Editor**, run this with your own email:
   ```sql
   insert into staff (email, name) values ('you@example.com', 'Your name');
   ```
5. Stop strangers from signing up: **Authentication → Sign In / Providers**, turn off **Allow new users to sign up**.
6. Click **Connect** at the top of the project (or open **Project Settings → API**) and copy two values: the **Project URL** and the **anon / publishable key**. Paste them into [`assets/js/config.js`](assets/js/config.js). (The anon key is meant to be public; the database rules protect your data.)

## 2. Turn on AI labelling

1. Go to [console.anthropic.com](https://console.anthropic.com), sign up, add a little credit under **Billing** ($5 lasts a long time), and create a key under **API Keys**. Copy it.
2. In Supabase open **Edge Functions → Deploy a new function → Via Editor**. Name it `label-toy`, replace the sample code with everything from [`supabase/functions/label-toy/index.ts`](supabase/functions/label-toy/index.ts) and click **Deploy**.
3. Open **Edge Functions → Secrets** and add a secret named `ANTHROPIC_API_KEY` with the key you copied.
   - Optional: to make labelling about 20 times cheaper, add `LABEL_MODEL` = `claude-haiku-5-5`. It is less accurate on brand names.

If labelling is not set up yet, uploads still work: toys arrive on the Review page as "Unnamed toy" for you to name.

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

## Daily use

1. Take photos on your phone.
2. Staff app → **Add toys**: pick the price, choose the photos (from the phone, or drag a folder on the laptop).
3. **Review**: fix anything the AI got wrong, then **Approve all**.
4. Customers order on WhatsApp. In **Orders**: Confirm → Mark paid → Print sticker → Packed → Sent.
5. Walk-in sale: **Stock**, tick the toys, **Sell in shop**.

Tip: on your phone, open the staff app and choose **Add to Home Screen** so it opens like an app.
