# Job Apply Assistant

A personal job-application tool that tailors my CV to each job ad **without inventing anything**, and tracks every application in one place.

Built on **Cloudflare Workers + KV**, with a single-file vanilla JS front end. No frameworks, no build step.

---

## What it does

| Feature | How it works |
|---|---|
| **ATS match score** | Paste a job ad (English or Arabic). Code (no AI) finds ~70 known skills/keywords in the ad and in my profile, and returns a score, the matched keywords (with the profile items that prove each one), and the missing ones. |
| **CV tailoring** | Builds a prompt with strict rules + my profile + the ad. I paste it into Claude (normal subscription, no API key), then paste the reply back. |
| **Anti-fabrication checker** | Claude's reply is verified in code before it is shown: every bullet must cite a real profile item, and any skill or number that doesn't exist in my profile is flagged or removed. |
| **Application tracker** | Company, title, link, date, status (applied / interview / rejected / offer), match score, notes, and the tailored CV + cover letter saved with each application. Stats tiles and CSV export (for Excel / Power BI). |

## Why the anti-fabrication design matters

LLMs are good at writing but can "improve" a CV with skills or numbers that aren't true. This tool doesn't rely on the model's promise. It uses **two layers**:

1. **The prompt** forbids new facts, lists the job's missing keywords as "do not claim", and requires every bullet to carry a `source_id` from the profile.
2. **The checker** (`src/tailor.js`) enforces it in code:
   - `source_id` that doesn't exist → **error**, bullet removed
   - skill keyword in the text that isn't in the profile → **warning**
   - number in the text that isn't in the profile (e.g. "5 years") → **warning**
   - "skill to highlight" not proven by the profile → **removed**

## How the match score works

```
score = matched keyword weight / total keyword weight
```

- Keywords come from a dictionary in `src/match.js`. Each has aliases in English and Arabic (`Power BI` = `powerbi` = `power-bi` = `باور بي آي`).
- Matching is whole-word and case-insensitive. Arabic aliases also handle attached prefixes (`الإكسل`, `وبايثون`).
- A keyword mentioned 2+ times in the ad counts double.
- Deterministic: the same ad + profile always gives the same score, and every match points to the profile item that proves it.

## Architecture

```
Browser (public/index.html)
   │  fetch + "Authorization: Bearer <APP_TOKEN>"
   ▼
Cloudflare Worker (src/worker.js)
   ├── match.js         keyword matching (pure functions)
   ├── tailor.js        prompt builder + reply checker
   ├── applications.js  tracker validation + stats
   └── KV namespace "DB"
         ├── profile        my CV data (the only source of truth)
         └── applications   tracker rows
```

### API

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | Public health check |
| GET | `/api/auth-check` | Verify token |
| GET / PUT | `/api/profile` | Read / validate + save the CV profile |
| POST | `/api/match` | Match score for a job ad |
| POST | `/api/prompt` | Build the tailoring prompt |
| POST | `/api/check` | Verify Claude's reply against the profile |
| GET / POST | `/api/applications` | List (+ stats) / add |
| PUT / DELETE | `/api/applications/:id` | Update / delete |

## Security & privacy

- Every `/api/*` route except `/api/health` requires a bearer token, compared in constant time.
- **Fail closed:** if `APP_TOKEN` isn't configured, all private routes return 500 instead of opening up.
- The token lives in `.dev.vars` locally and as a Worker **secret** in production. It is never in the code.
- Phone number, email and links are **stripped from the prompt**, since the model doesn't need them.
- Real profile data stays out of Git (`data/*.local.json` is ignored). `data/profile.example.json` shows the format with fake data.
- All user content is rendered with `textContent`, and tracker links must be `http(s)`.

## Project structure

```
job-apply-assistant/
├── wrangler.toml              Worker + static assets + KV binding
├── package.json               scripts: dev, deploy, test
├── src/
│   ├── worker.js              routing, auth, KV
│   ├── match.js               keyword dictionary + matching
│   ├── tailor.js              prompt builder + reply checker
│   └── applications.js        tracker validation + stats
├── public/
│   └── index.html             the whole UI (HTML + CSS + JS)
├── tests/                     node:test, no dependencies
├── data/
│   └── profile.example.json   profile format (fake data)
└── .dev.vars.example          APP_TOKEN template
```

## Run locally

Requires Node.js 18+ (21+ for `npm test`).

```bash
npm install
cp .dev.vars.example .dev.vars        # then set APP_TOKEN to a long random string
npm run dev                           # http://localhost:8787
npm test                              # 25 unit tests
```

In the UI, paste your token, then open `data/profile.example.json` (or your own `profile.local.json`) and click **Save profile**.

## Deploy to Cloudflare

```bash
npx wrangler login
npx wrangler kv namespace create DB    # copy the id into wrangler.toml
npx wrangler secret put APP_TOKEN      # paste a long random token
npm run deploy
```

## Profile format

```json
{
  "contact": { "name": "...", "email": "...", "title": "...", "location": "..." },
  "skills": { "languages": ["Python", "SQL"], "tools": ["Excel", "Power BI"] },
  "languages": [ { "name": "English", "level": "Working proficiency" } ],
  "experience": [
    { "id": "exp_company", "title": "...", "company": "...", "start": "2026-08", "end": "present",
      "bullets": ["..."], "skills": ["..."] }
  ],
  "projects": [ { "id": "proj_x", "name": "...", "link": "...", "bullets": ["..."], "skills": ["..."] } ],
  "education": [ { "id": "edu_x", "degree": "...", "school": "..." } ],
  "certifications": [ { "id": "cert_x", "name": "...", "issuer": "..." } ]
}
```

Ids must be unique and use only `a-z 0-9 _`. They are what tailored bullets cite.

## Roadmap

- [x] Phase 1: CV tailoring (match score, prompt, anti-fabrication checker) + application tracker
- [ ] Optional API mode: call the Claude API directly from the Worker (key stored as a secret)
- [ ] Phase 2: Tampermonkey userscript to fill repeated fields on job sites (never auto-submits)
- [ ] Phase 3: Daily digest of official job-alert emails (LinkedIn, Jadarat, Bayt), filtered by role and city

## Author

**Maher Al-Qurashi**, Data Analyst · [GitHub](https://github.com/MaherQ11) · [LinkedIn](https://linkedin.com/in/maher-al-qurashi-69a163351)
