# FlyPollo

Interactive live learning — run real-time questions with any audience and see
the results the moment they answer.

## Stack

- **Frontend:** React 19 + Vite 6, served as a static SPA
- **Serverless functions:** Netlify Functions (`netlify/functions`) — e.g. an
  Anthropic-powered question generator
- **Backend services:** Firebase — Firestore for the participant registry and
  question sets, Realtime Database for live session control
- **Hosting:** Netlify (frontend + functions together)
- **QR codes:** `qrcode` package, shown to presenters after publishing

## Project structure

```
.
├── netlify/
│   └── functions/
│       ├── generate-question.js   # (legacy, unused)
│       └── generate-mcq.js        # Transcript → 10 MCQs via Claude
├── public/
│   └── favicon.svg
├── src/
│   ├── config/
│   │   └── admin.js               # VITE_ADMIN_EMAILS whitelist (env-driven)
│   ├── components/
│   │   ├── Logo.jsx               # SVG brand mark
│   │   ├── Toasts.jsx             # Toast provider + useToast hook
│   │   └── ConfirmDialog.jsx      # Accessible confirmation dialog
│   ├── lib/
│   │   ├── session.js             # Session records, room codes, live-path helpers
│   │   ├── participant.js         # Participant profile storage & registry
│   │   └── report.js              # Session-based reports + per-session CSV
│   ├── pages/
│   │   ├── Landing.jsx            # Marketing + email entry
│   │   ├── Entry.jsx              # Email → admin / restore / register flow
│   │   ├── Dashboard.jsx          # Participant waiting room + quiz
│   │   └── Admin.jsx              # Presenter console
│   ├── App.jsx                    # Single-page view state
│   ├── firebase.js                # Firebase init from env vars
│   ├── main.jsx
│   └── index.css
├── .env.example                   # Required env vars (copy to .env)
├── netlify.toml                   # Build + functions + SPA redirects
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

### Admin access

Admin access is controlled by the `VITE_ADMIN_EMAILS` environment variable — a
comma-separated list of emails that may open the Presenter Console. Anyone who
enters one of those emails sees the Presenter Console; everyone else gets the
participant flow. There are no passwords and no separate admin route — edit the
variable in `.env` (or in Netlify's environment settings) and rebuild to grant
access.

```bash
VITE_ADMIN_EMAILS=admin1@example.com,admin2@example.com
```

### Firestore setup

The registration flow reads and writes the `participants` collection, and the
presenter console stores each quiz as its own session document under
`sessions/{sessionId}`. In the Firebase console, create a Firestore database.
For development you can start in test mode, or lock it down with rules like:

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

## Entry flow

Entering an email on the landing page routes to:

1. **Admin** — if the email is in `VITE_ADMIN_EMAILS`.
2. **Returning participant** — if a valid profile exists in localStorage, or a
   matching profile is found in Firestore (full name confirmation required).
3. **New participant** — registration form (name, email, institution,
   designation).

Profiles are keyed by the base64url-encoded email in
`participants/{encodedEmail}`. No passwords are used.

## Sessions

The admin first creates a **Session** (name, optional description, session
date) in the Presenter Console. Each session is its own document in Firestore at
`sessions/{sessionId}`:

```
sessions/{sessionId}
  sessionName       string          # e.g. "Cardiology Day 1"
  description       string          # optional
  sessionDate       "YYYY-MM-DD"    # metadata only
  status            "draft" | "published" | "live" | "completed"
  published         boolean
  createdAt         ISO timestamp
  publishedAt       ISO timestamp   # set on publish
  publishedBy       admin email     # set on publish
  roomCode          "FP-482913"     # set on publish
  qrCode            data URL        # set on publish
  questionCount     number
  participantCount  number
  questions         array of { question, options[4], correctIndex }
```

The workflow is: **Create Session → Upload Transcript → Generate Questions →
Review → Save Draft → Publish → Live Quiz → Completed.** The session's status is
shown in the dashboard as a coloured chip. Publishing requires confirmation and
stores publish metadata (`publishedBy`, `publishedAt`, `roomCode`, `sessionName`,
`questionCount`, `participantCount`, `status`) on the document.

Live state lives in Realtime Database at `session/live`:

```
{
  "questionIndex": number,          // 0-based index into questions
  "status": "idle" | "live" | "ended",
  "sessionId": string,              // the Firestore session document id
  "sessionDate": "YYYY-MM-DD",      // kept for legacy compatibility
  "roomCode": "FP-482913"           // set on publish
}
```

Participants subscribe to `session/live`: `idle` shows a waiting room,
`live` fetches the current question and its 4 options from `sessions/{sessionId}`
and renders tappable buttons, and `ended` shows a completion screen.

Answers are stored in Firestore at
`sessions/{sessionId}/answers/{questionIndex}/{participantId}` with shape
`{ selectedIndex, timestamp }`. Each participant's answer for a question is
locked once submitted. The presenter console subscribes to the current
question's answer doc with `onSnapshot` and renders a live per-option bar count,
plus a session-wide participant count.

Legacy sessions created before this change (keyed by date at
`sessions/{YYYY-MM-DD}`) keep working: the reader resolves `sessionId` when
present and falls back to the date document. No migration is required and
existing collections are left untouched.

## Reports

The presenter console's **Reports** section lists every session with its name,
date, status chip, participant count and average score, plus a per-session
**Download CSV** button. Each CSV exports `Name, Email, Institution,
Designation, Correct, Answered, Total, Score %` for the participants who
answered, saved as `flypollo-results-{session-name}.csv` (UTF-8 with BOM for
spreadsheet compatibility).

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
