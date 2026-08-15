# FlyPollo

Interactive live learning — run real-time questions with any audience and see
the results the moment they answer.

## Stack

- **Frontend:** React 19 + Vite 6, served as a static SPA
- **Serverless functions:** Netlify Functions (`netlify/functions`) — e.g. a
  Groq-powered MCQ generator
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
│       └── generate-mcq.js        # Transcript → 2/5/10 MCQs via Groq
├── public/
│   └── logo.png
├── src/
│   ├── config/
│   │   └── admin.js               # VITE_ADMIN_EMAILS whitelist (env-driven)
│   ├── components/
│   │   ├── Logo.jsx               # PNG brand mark
│   │   ├── Toasts.jsx             # Toast provider + useToast hook
│   │   ├── ConfirmDialog.jsx      # Accessible confirmation dialog
│   │   ├── AdminLayout.jsx        # Sidebar + topbar shell for the console
│   │   ├── StatusChip.jsx         # Session status chip
│   │   ├── ConnectionPill.jsx     # RTDB connectivity indicator
│   │   └── SessionCard.jsx        # History card with Open / CSV / Delete
│   ├── lib/
│   │   ├── session.js             # Session records, room codes, share links, live-path helpers
│   │   ├── participant.js         # Participant profile storage & registry
│   │   ├── report.js              # Session-based reports + CSV exports + participant stats
│   │   ├── copy.js                # Clipboard helper
│   │   └── useAdminStore.js       # Shared presenter-console state & actions
│   ├── pages/
│   │   ├── Landing.jsx            # Marketing + email entry
│   │   ├── Entry.jsx              # Email → admin / restore / register flow
│   │   ├── Join.jsx               # Standalone room-code screen (optional entry point)
│   │   ├── Dashboard.jsx          # Participant hub: quick join, waiting room, quiz, results
│   │   ├── Admin.jsx              # Presenter console (sidebar shell + routing)
│   │   └── admin/
│   │       ├── DashboardPage.jsx      # Overview cards + recent sessions
│   │       ├── CreateSessionPage.jsx  # Create → upload → review → publish
│   │       ├── LiveSessionPage.jsx    # Room code, QR, live controls
│   │       ├── SessionHistoryPage.jsx # Session cards + delete
│   │       ├── ReportsPage.jsx        # Date-range summary + CSV exports
│   │       └── ParticipantsPage.jsx   # Participant registry table
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
- A Groq API key for MCQ generation (`GROQ_API_KEY`)
- (Optional) A Firebase project for live session state

## Local Setup

```bash
npm install
npm run dev
```

Firebase configuration comes from `.env` — Vite exposes the `VITE_FIREBASE_*`
variables to the browser at dev and build time. If `.env` is missing, copy
`.env.example` to `.env` and fill in your Firebase web config values.

Server-side variables (`GROQ_API_KEY` for `generate-mcq` and the legacy
`generate-question`, optional `MODEL_NAME`) are added separately — they are
only used by the Netlify Functions, not the frontend.

## Setup

```bash
npm install
cp .env.example .env   # or on Windows: Copy-Item .env.example .env
```

Fill in the variables in `.env`. `generate-mcq` reads `GROQ_API_KEY` from the
environment; the Vite frontend reads `VITE_FIREBASE_*`. The Groq model used by
`generate-mcq` can be overridden with `MODEL_NAME` (defaults to
`llama-3.3-70b-versatile`).

### Admin access

Admin access is controlled by the `VITE_ADMIN_EMAILS` environment variable — a
comma-separated list of emails that may open the Presenter Console. When unset,
it falls back to the built-in whitelist (`kulnikita20@gmail.com`,
`pratima2k1@gmail.com`). Anyone who enters one of those emails sees the
Presenter Console; everyone else gets the participant flow. There are no
passwords and no separate admin route — edit the variable in `.env` (or in
Netlify's environment settings) and rebuild to grant access.

```bash
VITE_ADMIN_EMAILS=kulnikita20@gmail.com,pratima2k1@gmail.com
```

### Firebase security rules

The registration flow reads and writes the `participants` collection, the
presenter console stores each quiz as its own session document under
`sessions/{sessionId}`, and live state lives in the Realtime Database under
`sessions/{sessionId}/live` (with a legacy mirror at `session/live`).
Production rules for both are committed at the repo root:

- `firestore.rules` — Firestore rules (paste under **Firestore > Rules**)
- `database.rules.json` — Realtime Database rules (paste under **Realtime
  Database > Rules**)

The rules enforce:

- **Self-service participants.** Anyone may register by writing only their own
  profile doc in `participants/{docId}`; profiles can never be updated or
  deleted, and every write is shape-validated.
- **Constrained sessions.** Draft docs must start as valid `draft` records and
  may only be edited in place while they remain drafts. Every publish creates a
  **new, content-immutable snapshot** document: only its lifecycle status
  (`published → live → completed`), its own `participantCount` and the
  `analytics` summary may change, and in-progress (`live`) sessions cannot be
  deleted.
- **Locked answers.** Answers live at
  `sessions/{sessionId}/answers/{questionIndex}` and may only be written while
  the session is `live`. Each write may add exactly **one new** entry for the
  submitter with `{ selectedIndex (0–3), timestamp }` — existing entries can
  never be overwritten or removed, so no participant can tamper with another's
  answers.
- **Live state.** Each published session has its own readable live document at
  `sessions/{sessionId}/live`; writes must carry valid status/questionIndex
  values through the allowed status transitions and the `sessionId` must match
  the path segment. The legacy `session/live` path keeps the same rules for
  older clients.

Both files are validated client-side by the app (see `participant.js`,
`useAdminStore.js`, `Dashboard.jsx`); the rules mirror that contract on the
server.

**Known limitations (no Firebase Auth).** The app has no authentication, so
rules cannot tell a real admin from an anonymous visitor. Reads of `sessions`,
`participants`, and `answers` must stay public for the present features (admin
console, participant score history, and reports all read them). This means:
everyone can read participant PII and can perform the presenter's write actions
(create/update sessions, drive `sessions/{sessionId}/live`) as long as they
respect the shape and transition rules above. For real per-user protection, add
Firebase **anonymous authentication** (invisible to users) and then bind answer
keys and admin writes to `request.auth` in these rules.

## Participant flow

Entering an email on the landing page routes to:

1. **Admin** — if the email is in `VITE_ADMIN_EMAILS` (or the built-in
   fallback whitelist). Opens the Presenter Console immediately.
2. **Returning participant** — if a valid profile exists in localStorage, or a
   matching profile is found in Firestore. Opens the Participant Dashboard
   directly.
3. **New participant** — registration form (name, email, institution,
   designation).

Either way, participants land on their **Participant Dashboard** — a hub with a
welcome header, a profile card, **Quick Join**, **Current Session**, **Past
Sessions** and **Recent Scores**.

- **Not joined yet:** the dashboard shows a "Join Today's Session" card with a
  room code box and an **OR · Scan QR** option (native camera QR scanning via
  the browser's BarcodeDetector where available, with graceful fallback).
- **Joined & waiting:** the Current Session card shows the joined session name,
  room code and a "Waiting for the presenter to start…" indicator.
- **Quiz:** the live question fills the screen, then the results screen shows
  the participant's score alongside their recent scores and past sessions.

Room codes are looked up in Firestore's `sessions` collection; only
published/live/completed sessions match. On success the joined session
(`sessionId`, `roomCode`, `sessionName`) is saved to localStorage and the
Current Session card appears. An invalid code shows "Room code not found." and
does not proceed.

**Room links:** every published session has a share link of the form
`https://flypollo.netlify.app?room=FP-482913` (also encoded in its QR code).
Opening that link prefills the room code in Quick Join; if the room is valid the
participant joins automatically, otherwise the box stays editable so the code
can be corrected.

The Current Session card shows the connection state, the joined session name
and room code, and a "Waiting for the presenter to start…" message.

**Sign out** clears both localStorage keys (`flypollo.participant` and
`flypollo.joinedSession`) and returns to the landing page. Joining a new room
code replaces the previously stored joined session; participant profiles are
keyed by the base64url-encoded email in `participants/{encodedEmail}`, so no
duplicate participant records are ever created. No passwords are used.

## Sessions

The admin first creates a **Session** (name, optional description, session
date) in the Presenter Console. Sessions live in Firestore at
`sessions/{sessionId}` as **draft documents** (the editable working copy) and
as **published snapshots** (immutable records created fresh on every publish):

```
sessions/{sessionId}            # two kinds of documents
  sessionName       string      # e.g. "Cardiology Day 1"
  description       string      # optional
  sessionDate       "YYYY-MM-DD"# metadata only
  status            "draft" | "published" | "live" | "completed"
  published         boolean     # false for drafts, true for snapshots
  createdAt         ISO timestamp  # when the session was first created
  updatedAt         ISO timestamp  # last lifecycle update
  publishedAt       ISO timestamp  # set on publish (snapshots)
  publishedBy       admin email    # set on publish (snapshots)
  presenter         admin email    # presenter identity, set on publish
  transcriptFilename string        # source transcript, set on publish
  roomCode          "FP-482913"    # unique per publish
  shareUrl          URL            # https://flypollo.netlify.app?room=FP-482913
  qrUrl             data URL       # QR of shareUrl, generated on publish
  questionCount     number
  participantCount  number
  questions         array of { question, options[4], correctIndex }
  analytics         map            # { participantCount, totalAnswers,
                                   #   questionCount, perQuestion, computedAt }
                                   # written when the snapshot is completed
  draftId           string         # id of the draft it was published from
```

The workflow is: **Create Session → Upload Transcript → Generate Questions →
Review → Save Draft → Publish → Live Quiz → Completed.**

- **Drafts** (`status: "draft"`) are the editable working copy. One is created
  per session, can be saved repeatedly, and is never published in place.
- **Publishing** creates a **brand-new, immutable session object** in a fresh
  `sessions/{sessionId}` document. The new object carries its own unique
  `roomCode`, `shareUrl` and QR, plus `publishedAt`, `publishedBy`,
  `presenter`, `transcriptFilename`, a copy of the questions, and a link back
  to the source draft via `draftId`. **Nothing is ever overwritten** — every
  publish produces one more record, and re-publishing creates a new room.
- Published snapshots are content-immutable: only their lifecycle
  `status` (`published` → `live` → `completed`), their own `participantCount`
  and the `analytics` summary may change. Firestore security rules enforce
  this on every update.
- **Session History** reads these snapshot documents, so each publish appears
  as its own history row with its own participants, answers, reports and
  analytics.
- **Back to editing** returns to the editable draft (via `draftId`) and leaves
  the published snapshot untouched on record.

Live state is stored **per session** in Realtime Database at
`sessions/{sessionId}/live`:

```
sessions/{sessionId}/live
{
  "questionIndex": number,          // 0-based index into questions
  "status": "idle" | "live" | "ended",
  "sessionId": string,              // must match the {sessionId} path segment
  "sessionDate": "YYYY-MM-DD",      // kept for legacy compatibility
  "roomCode": "FP-482913"           // set on publish
}
```

Each published session owns its own live document, so two presenters can run
two rooms at the same time without affecting each other. The presenter console
subscribes to the live document of the session it currently has selected, and
participants subscribe to the live document of the session they joined (found
by room code). `idle` shows a waiting room, `live` fetches the current question
and its 4 options from the published `sessions/{sessionId}` and renders
tappable buttons, and `ended` shows a completion screen.

**Backwards compatibility.** The presenter console still mirrors every live
write to the old global path `session/live`. Older cached clients that only
subscribe to `session/live` keep working: they see the most recently driven
room. New clients ignore the global path and follow their own session.

Answers are stored in Firestore at
`sessions/{publishedSessionId}/answers/{questionIndex}/{participantId}` with
shape `{ selectedIndex, timestamp }`. Because every participant reads and
answers into the exact session they joined, reports/analytics read the same
document and rooms never cross-contaminate. Each participant's answer for a
question is locked once submitted. The presenter console subscribes to the
current question's answer doc with `onSnapshot` and renders a live per-option
bar count, plus a session-wide participant count. The Firestore answer rule
(`isLiveSession`) already gates writes on the individual session's own
`status`, so no Firestore changes were needed.

Legacy sessions created before the room-code change (keyed by date at
`sessions/{YYYY-MM-DD}`) keep working: the reader resolves `sessionId` when
present and falls back to the date document. No migration is required and
existing collections are left untouched.

## Presenter Console

The console is a multi-page dashboard with a fixed sidebar (FlyPollo logo, then
**Dashboard**, **Create Session**, **Live Session**, **Session History**,
**Reports**, **Participants**; the signed-in admin email and **Sign out** live
at the bottom). On small screens the sidebar collapses behind a hamburger.

- **Dashboard** — Today's Session card (status, room code, participants,
  questions, responses, average score when finished), quick actions (Create New
  Session, Resume Live Session, Open Reports) and the five most recent
  sessions.
- **Create Session** — the create → upload transcript → review questions →
  publish flow. Drafts can be saved and resumed.
- **Live Session** — large room code, large QR, **Copy Link** / **Copy Room
  Code** buttons, participant count, question progress (Prev/Next plus ← / →
  arrow keys) and live per-option answer bars.
- **Session History** — every session newest first as a card with **Open**,
  **Download CSV** and **Delete** actions.
- **Reports** — pick a date range, **Generate** a summary (sessions,
  participants, average score), download a combined **summary CSV** or
  per-session results CSVs.
- **Participants** — a searchable table of everyone who registered: Name,
  Email, Institution, Designation, Sessions Joined and Last Active (read-only).

## Reports

The **Reports** page lets a presenter filter sessions by date range and
download results. Per-session CSVs export `Name, Email, Institution,
Designation, Correct, Answered, Total, Score %` for the participants who
answered, saved as `flypollo-results-{session-name}.csv` (UTF-8 with BOM for
spreadsheet compatibility). The summary CSV exports one row per session with
session name, date, status, room code, question count, participant count,
average score and share link.

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
