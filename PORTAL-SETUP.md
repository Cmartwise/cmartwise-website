# Student Portal — Setup Guide
*Do this once. Takes about 15 minutes.*

---

## Step 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → Sign up (free, no credit card needed)
2. Click **New project**
3. Name it `cmartwise` · choose a strong password · pick region **Europe (Frankfurt)** → Create

---

## Step 2 — Run the database schema

1. In your Supabase project → **SQL Editor** → **New query**
2. Open `supabase/schema.sql` from your website folder
3. Paste the entire contents → click **Run**

---

## Step 3 — Deploy the edge functions

### Translate function (already exists in your project — skip if done)
### Generate-test function (new):

1. Supabase dashboard → **Edge Functions** → **New function** → name it `generate-test`
2. Paste the contents of `supabase/functions/generate-test/index.ts`
3. Deploy

### Evaluate-speaking function:
1. Same process → name it `evaluate-speaking`
2. Paste `supabase/functions/evaluate-speaking/index.ts`
3. Deploy

---

## Step 4 — Set your Anthropic API key

1. Supabase → **Project Settings** → **Edge Functions** → **Secrets**
2. Add secret: `ANTHROPIC_API_KEY` = your key from console.anthropic.com

---

## Step 5 — Get your Supabase credentials

1. Supabase → **Project Settings** → **API**
2. Copy:
   - **Project URL** (looks like `https://xyzxyz.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)

---

## Step 6 — Update the portal HTML files

In each of these files, replace the two placeholder values at the top of the `<script>` section:

**Files to update:**
- `portal.html`
- `portal-dashboard.html`
- `portal-notes.html`
- `portal-resources.html`
- `portal-tests.html`

**Replace:**
```js
const SUPABASE_URL  = 'YOUR_SUPABASE_URL'
const SUPABASE_ANON = 'YOUR_SUPABASE_ANON_KEY'
```

**With your actual values:**
```js
const SUPABASE_URL  = 'https://xyzxyz.supabase.co'
const SUPABASE_ANON = 'eyJhbGci...'
```

In `portal-resources.html` also update:
```js
const TRANSLATE_FN = 'YOUR_SUPABASE_URL/functions/v1/translate'
```

In `portal-tests.html` also update:
```js
const GENERATE_TEST_FN   = 'YOUR_SUPABASE_URL/functions/v1/generate-test'
const EVALUATE_SPEAKING_FN = 'YOUR_SUPABASE_URL/functions/v1/evaluate-speaking'
```

---

## Step 7 — Make yourself an admin

1. Go to your live site → `cmartwise-coaching.eu/portal.html`
2. Sign up with `cmartwise@gmail.com`
3. Confirm your email
4. In Supabase → **SQL Editor** → run:
   ```sql
   update public.profiles set role = 'admin' where email = 'cmartwise@gmail.com';
   ```

---

## Step 8 — Push to GitHub → Netlify deploys automatically

```
git add -A
git commit -m "Student portal + test generator"
git push origin main
```

---

## How to add a student

1. Ask them to sign up at `cmartwise-coaching.eu/portal.html`
2. They confirm their email
3. They're in — no further action needed from you

## How to add coaching notes

1. Sign in as yourself (admin)
2. Go to `/portal-notes.html`
3. Click **+ Add note (admin)**
4. Select the student, date, title, tags, and write the notes in markdown
5. Save — the student sees it instantly

## What students can do

- Read their private coaching notes
- Access shared resources and the PT Translator
- Take timed practice tests (CIPLE/DIPLE/IELTS/GRE) with AI feedback
