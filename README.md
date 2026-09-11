# SEC ATS Pick'em

Backend-hosted rebuild of the SEC Pick'em app on Cloudflare Workers + D1.
Deploys automatically via GitHub Actions (Cloudflare's API isn't reachable
from the environment this was built in, so CI does the actual deploy).

## One-time setup

1. **Create a new GitHub repo** (public or private, doesn't matter) and push
   this folder to it:

   ```bash
   git init
   git add -A
   git commit -m "Initial commit: SEC Pick'em Cloudflare Workers app"
   git branch -M main
   git remote add origin <your-new-repo-url>
   git push -u origin main
   ```

2. **Add three repo secrets** (GitHub repo → Settings → Secrets and
   variables → Actions → "New repository secret"):

   | Secret name            | Value                                          |
   |-------------------------|------------------------------------------------|
   | `CLOUDFLARE_API_TOKEN`  | Your Cloudflare API token (Workers edit scope) |
   | `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID                     |
   | `AUTH_SECRET`           | A long random string (see note below)          |

   For `AUTH_SECRET`, generate one yourself, e.g. `openssl rand -hex 32` --
   this signs the login tokens, so keep it secret and don't change it later
   (changing it logs everyone out).

3. **Push to `main`** (or run the "Deploy SEC Pick'em" workflow manually from
   the Actions tab). The workflow will:
   - Create the D1 database on first run (and commit the real database id
     into `wrangler.toml`)
   - Apply the schema
   - Seed the initial state from `seed-state.json` (only if the database is
     empty -- it will never overwrite live data on later deploys)
   - Set the `AUTH_SECRET` Worker secret
   - Deploy the Worker

4. Once the workflow finishes, find your app's URL in the deploy step's log
   (`https://sec-pickem.<your-subdomain>.workers.dev`), or in the Cloudflare
   dashboard under Workers & Pages.

## Making changes later

Just push to `main` -- the workflow re-deploys automatically. It will not
re-seed or touch existing picks/results.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # if present, else create your own AUTH_SECRET
npx wrangler d1 execute sec-pickem-db --local --file=./schema.sql
node scripts/seed.js --local
npm run dev
```
