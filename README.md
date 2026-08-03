# Flypollo

A live quiz web app for hospital training and education. Presenters create and
launch quiz questions on `/admin`; participants join on `/join` and answer in
real time.

## Stack

- **Frontend:** React 19 + Vite 6 + React Router, served as a static SPA
- **Serverless functions:** Netlify Functions (`netlify/functions`) — e.g. an
  Anthropic-powered question generator
- **Backend services:** Firebase — Firestore for the participant registry and
  draft question sets, Realtime Database for live session control
- **Hosting:** Netlify (frontend + functions together)
- **QR codes:** `qrcode` package on the join screen

## Project structure

```
.
├── netlify/
│   └── functions/          # Serverless functions (API)
│       ├── generate-question.js
│       └── generate-mcq.js # Transcript → 10 MCQs via Claude
├── public/                 # Static assets
├── src/
│   ├── pages/              # Home, Admin, Join
│   ├── App.jsx             # Routes: /, /admin, /join
│   ├── firebase.js         # Firebase init from env vars
│   ├── main.jsx
│   └── index.css
├── .env.example            # Required env vars (copy to .env)
├── netlify.toml            # Build + functions + SPA redirects
├── index.html
├── package.json
└── vite.config.js
```

## Prerequisites

- Node.js 20+ and npm
- Netlify CLI: `npm install -g netlify-cli`
- An Anthropic API key for question generation
- (Optional) A Firebase project for live session state

## Local Setup

```bash
npm install
npm run dev
```

Firebase configuration comes from `.env` — Vite exposes the `VITE_FIREBASE_*`
variables to the browser at dev and build time. If `.env` is missing, copy
`.env.example` to `.env` and fill in your Firebase web config values.

Anthropic variables (`ANTHROPIC_API_KEY`, optional `MODEL_NAME`) are added
separately — they are only used by the Netlify Functions, not the frontend.

## Setup

```bash
npm install
cp .env.example .env   # or on Windows: Copy-Item .env.example .env
```

Fill in the variables in `.env`. Serverless functions read `ANTHROPIC_API_KEY`
from the environment; the Vite frontend reads `VITE_FIREBASE_*`. The Claude
model used by `generate-mcq` can be overridden with `MODEL_NAME` (defaults to
`claude-opus-4-8`).

### Firestore setup

The `/join` registration flow reads and writes the `participants` collection,
and the `/admin` flow writes draft question sets to `sessions/{date}`. In the
Firebase console, create a Firestore database. For development you can start in
test mode, or lock it down to this app with rules like:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

Restrict these rules (auth, domain checks, etc.) before going to production.

## Live sessions

The presenter console loads or creates today's question set in Firestore at
`sessions/{YYYY-MM-DD}` (`status: "draft" | "ready"`, `questions` as an ordered
array). Once a set is marked ready, the presenter gets a control panel with
Previous/Next (and ← / → keyboard) controls that drive the live state in
Realtime Database at `session/live`:

```
{
  "questionIndex": number,          // 0-based index into questions
  "status": "idle" | "live" | "ended",
  "sessionDate": "YYYY-MM-DD"       // same date as the Firestore path
}
```

Participants subscribe to `session/live`. When `status` is `idle` they see a
waiting screen; when `live` the current question and its 4 options are fetched
from `sessions/{sessionDate}` and rendered as tappable buttons; `ended` shows a
closing screen.

Answers are stored in Firestore at
`sessions/{date}/answers/{questionIndex}/{participantId}` with shape
`{ selectedIndex, timestamp }`. Each participant's answer for a question is
locked once submitted (and once the presenter advances past the question). The
presenter console subscribes to the current question's answer doc with
`onSnapshot` and renders a live per-option bar count.

## Reports

The presenter console's **Generate report** button pulls all participants,
sessions' questions, and answers from Firestore for the event's date range
(editable via From/To inputs), computes each participant's correct-answer count
per day plus a total, and renders a "FlyPollo — Session Results" table. The
**Download CSV** button exports the table as `flypollo-results-{from}-{to}.csv`
(UTF-8 with BOM for spreadsheet compatibility).

The join screen derives today's room code from the session date (e.g.
`FP-482913`) and renders a QR code that encodes the join URL
(`${origin}/join`).

## Local development

```bash
netlify dev
```

`netlify dev` serves the Vite dev server **and** the serverless functions
together, so the frontend can call functions at `/.netlify/functions/...`.
Open the printed URL (default `http://localhost:8888`).

To only run the frontend (functions unavailable):

```bash
npm run dev
```

## Deploying

### Manual deploy (Netlify Drop / CLI)

```bash
netlify deploy --build --prod
```

`netlify.toml` tells Netlify to run `npm run build` and publish `dist`, and to
deploy `netlify/functions` alongside. For a staging preview, drop `--prod`:

```bash
netlify deploy --build
```

### CI / GitHub

1. Push the repo to GitHub.
2. In Netlify, add the site, connect the repo, and set:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
3. Set the environment variables from `.env.example` in **Site settings >
   Environment variables**. Do not commit a real `.env`.

## Calling functions from the frontend

Functions are invoked relative to the site, so the same code works locally and
in production:

```js
const res = await fetch("/.netlify/functions/generate-question", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ topic: "infection control" }),
});
```

## Routes

| Route    | Purpose                                        |
| -------- | ---------------------------------------------- |
| `/`      | Landing page linking to Admin and Join         |
| `/admin` | Presenter console — generate and run questions |
| `/join`  | Participant view — join with a room code       |
