# eCW Implementation Tracker — Vascular Health Partners

A shared, editable tracker for the eClinicalWorks implementation. Everyone who opens the
site sees the same plan. Changes save automatically and are recorded in the Activity tab.

## What's inside
- `public/index.html` — the app (pre-loaded with the eCW implementation plan)
- `netlify/functions/plan.mjs` — saves the shared plan in Netlify Blobs (built into Netlify; no outside database)
- `netlify.toml`, `package.json` — Netlify settings

## Deploy (about 10 minutes)
Netlify's drag-and-drop upload does **not** run the save function, so use one of these:

**Option A — GitHub (easiest to maintain)**
1. Create a new private GitHub repository and upload the contents of this folder.
2. In Netlify: **Add new site → Import an existing project → GitHub**, pick the repo.
3. Leave the build settings as detected (publish directory `public`) and click **Deploy**.

**Option B — Netlify CLI**
```
npm install -g netlify-cli
cd ecw-tracker
npm install
netlify login
netlify init        # create a new site
netlify deploy --prod
```

## Set an edit passcode (strongly recommended)
Without it, anyone with the link can change the plan.
Netlify → Site configuration → Environment variables → add `EDIT_KEY` with a passcode of your
choice → then **Deploys → Trigger deploy**. People enter the passcode once per device the first
time they edit. Anyone can still view.

## First run
The first person to make an edit saves the plan to the shared store. After that, everyone
shares that copy. The page checks for teammates' changes every 20 seconds, and if two
people save at once, both sets of edits are kept.

## Backups
**Export** downloads a JSON backup of the whole plan; **Import** restores one.
Each tab also has **Download CSV** for Excel.

## Note
Don't put patient information in this tracker. It is meant for project tasks, dates and vendor contacts only.
