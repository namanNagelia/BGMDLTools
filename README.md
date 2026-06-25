# bgmdlFA

Automated free agency tool for bgmdl.

Right now it's just the mod side: pull the league JSON from a Dropbox link, auto-detect the season, store it, manage which one's current.

## Stack

- **Backend** — Express + TypeScript, Drizzle ORM, Postgres on Railway → `/backend`
- **Frontend** — Next.js 16 + Tailwind v4 → `/fe`
- **Auth** — single shared mod password → JWT in an httpOnly cookie. No user accounts.

## Run it locally

You need a `.env` in each dir (see the `.env.example` files).

```bash
# backend (port 4000)
cd backend
npm install
npm run db:push    # apply schema to the DB pointed at by DATABASE_URL
npm run dev

# frontend (port 3000)
cd ../fe
npm install
npm run dev
```

Then hit `http://localhost:3000`. The mod console is at `/mod`.

## Mod flow

1. Log in with the shared password
2. Paste the Dropbox link to the BBGM league export → **PULL & FILE**
3. Backend fetches it (handles `.json.gz`), reads the season number out of `gameAttributes.season`, upserts the row
4. Mark a season current with the row's **MARK** button. Only one current at a time.
5. **DEL** removes a season (two-click confirm).

## DB

One table for now: `seasons (id, season_number, league_link, is_current_szn)`. More coming as we add FA cap holds, values, offers, etc.

Migrations live in `backend/drizzle/` — committed. After changing `schema.ts`:

```bash
npm run db:generate   # writes a new .sql migration
npm run db:push       # diffs schema vs DB and applies (dev shortcut)
```

## Deploying (later)

- Backend → Railway service (already has the DB there). Use the internal `postgres.railway.internal` URL in prod.
- Frontend → Vercel. Set `NEXT_PUBLIC_API_URL` to the backend's public Railway URL.

## TODO

- parse spreadsheet for team values
- GM offer submission UI on `/`
- Cap + value calc engine
- G league automate????????????
