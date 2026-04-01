# Project Intelligence

## MANDATORY: Load MentraOS Docs Before Any Work

**This is a Mentra project. Before answering ANY question, debugging, or writing code:**

1. Read `.claude/skills/mentra-docs/SKILL.md` and follow its instructions
2. At minimum: load the relevant sections from `docs/llms-full.txt` for the user's current task
3. Tell the user which doc version you're working from (check `docs/.mentra-docs-version`)

Do NOT browse `docs.mentraglass.com` or `cloud-docs.mentra.glass` — the local `docs/llms-full.txt` is the authoritative source. Only fetch remotely if the local file is missing or outdated per the skill's version-check process.

**If you skip this step, you will waste the user's time with ungrounded answers.**

## Research Standards

- **Never rely solely on WebSearch results to make hardware or SDK compatibility claims.** WebSearch returns search engine summaries, not verified documentation. Before stating that a product has an API, SDK, or developer program that supports a specific model, navigate to the actual documentation (using Chrome browser tools or WebFetch) and confirm the claim firsthand.
- When evaluating hardware for integration (cameras, sensors, wearables), always verify the supported device list directly from the manufacturer's developer documentation before recommending a product.
- Be explicit with the user about the confidence level of information: distinguish between "search results suggest" and "I read the documentation and confirmed."

## Project Overview

Kitchen Appliance Site Survey miniapp for **MentraOS smart glasses** (Mentra Live). Voice-only UI on glasses (no display), guiding a technician through a structured checklist stored in Google Sheets, capturing photos and audio narration at each step.

- **Owner:** Tom Elliott (tom.elliott@resqware.solutions) — partially deaf, needs max volume/clarity from TTS
- **Framework:** MentraOS SDK (`@mentra/sdk@3.0.0-hono.8`) — Hono-based AppServer
- **Runtime:** Bun + ngrok for local dev
- **Package name:** `appliancesurvey.mentra.glass`

## Architecture

- `src/index.ts` — Main entry. Extends `AppServer`, handles `onSession`/`onStop` lifecycle. Bun.serve with `idleTimeout: 255` for SSE.
- `src/server/SurveyApp.ts` — Survey state machine. Loads steps from Google Sheets, handles transcription wake words, photo capture, step progression.
- `src/server/session/User.ts` — Per-user state container. Composes all managers.
- `src/server/manager/AudioManager.ts` — TTS wrapper. Uses ElevenLabs "Henry" voice (ID: `pVnrL6sighQX7hVz89cp`) with custom settings.
- `src/server/manager/PhotoManager.ts` — Photo capture (size: "large" for 1080p), disk save, SSE broadcast.
- `src/server/manager/TranscriptManager.ts` — Chronological transcript of TTS/STT/photos. Generates HTML with inline base64 images, uploads to Google Drive as native Google Doc.
- `src/server/manager/SheetManager.ts` — Google Sheets integration for survey script.
- `src/server/manager/RecordManager.ts` — Session folder creation, MP3 conversion placeholder (Phase 2).

## Key Design Decisions

### SDK Pattern
- `index.ts` extends `AppServer` and calls `app.start()` — this is the correct SDK pattern. Previous Gemini implementation incorrectly mocked MentraOS Cloud endpoints ("nuclear bridge" pattern). Never go back to that.
- `onSession` fires when glasses connect via webhook from MentraOS Cloud. Survey startup is **fire-and-forget** (`.catch()`) to avoid blocking `onSession`.
- **Never set a Custom Cloud URL** in the iPhone app's Developer Settings — that's only for Cloud contributors, not miniapp developers.

### Survey Flow
- Steps loaded from Google Sheet (ID: `1gVo4zV7Acxe5gEpcQmM0_Rne_MmuFjay7GJKZE5lzcw`)
- Wake word matching uses word-boundary checking with punctuation stripping (`words = lowerText.split(/\s+/).map(w => w.replace(/[^a-z]/g, ''))`)
- Trigger words from sheet also get punctuation stripped: `.replace(/[^a-z\s]/g, '')`
- Photo capture: await the photo, then "Image captured and processing.", then "Image complete. Capture or next?"
- Survey ends when user says "finish" on the CONCLUSION step, triggering `finishSurvey()` which generates transcript and uploads to Google Drive
- `surveyApp.reset()` is called at start of `onSession` for clean restarts

### TTS Voice Configuration
- Voice: ElevenLabs "Henry" (`pVnrL6sighQX7hVz89cp`) — Mentra accepted the custom voice_id
- Settings: stability 0.75, similarity_boost 0.75, style 0, use_speaker_boost true, speed 1.1, volume 1.0
- These are passed via `TTS_OPTIONS` in `AudioManager.ts`

### Transcript & Google Doc
- `TranscriptManager` captures APP (TTS), USER (STT), and PHOTO entries with timestamps
- At survey end: generates self-contained HTML with base64 inline images, saves locally, uploads to Google Drive
- Google Drive upload converts HTML to native Google Doc via multipart upload with `mimeType: "application/vnd.google-apps.document"`

### Google Service Account
- Email: `mentra-survey-manager@mentra-survey-app.iam.gserviceaccount.com`
- Role: Editor on project
- APIs enabled: Google Sheets API, Google Drive API
- Credentials file: `service-account.json` in project root

## Current Issue — Google Drive Upload Failing

**Status: UNRESOLVED** — The Google Drive upload fails with `403: storageQuotaExceeded`. The service account has zero Drive storage quota.

### What's Been Tried
1. Uploading to a shared folder in Tom's Drive (`GOOGLE_DRIVE_FOLDER_ID=1JxG1VhyiaRRCckjAQ4wk_xEwL9aLkjtJ`) — still fails because file ownership = service account
2. Adding `supportsAllDrives=true` to upload URL — still fails
3. Transfer ownership after upload — can't transfer because upload itself fails
4. Service account impersonation (`subject: tom.elliott@resqware.solutions` in JWT) — requires domain-wide delegation setup

### Next Steps to Fix
Tom has Google Workspace (paid). To enable domain-wide delegation:
1. **Google Cloud Console** → Service account → Advanced settings → Enable "Domain-wide delegation" → get Client ID
2. **Google Workspace Admin** (admin.google.com) → Security → API Controls → Domain-wide Delegation → Add new → Enter Client ID + scope `https://www.googleapis.com/auth/drive.file`
3. The code already has the `subject` impersonation in `TranscriptManager.ts` — once delegation is enabled, it should work

### Alternative Approach (if delegation is too complex)
Upload a text-only transcript (no images) which would be tiny. Or upload images as separate Drive files first, then reference them by URL in the HTML.

## Bluetooth Constraints
- All data flows: glasses → BT → phone → internet → Cloud → server
- Apple's BT bandwidth restricts image transfer speed — Mentra waiting on Apple approval for higher bandwidth
- Glasses have WiFi but only for firmware updates, not data transfer to apps
- No offline capability — miniapp requires internet

## Dev/Test Workflow — Shared Observability

When Tom is actively testing (especially with glasses), use this pattern:

1. Tom runs the server in his terminal: `bun dev 2>&1 | tee logs/dev.log`
2. Claude reads `logs/dev.log` on request — no copy-paste needed
3. Claude does NOT fix errors mid-test — observe, take notes, build context
4. When Tom says he's done testing, Claude shares observations and suggests fixes
5. Worktree sessions need `.env` and `service-account.json` symlinked from the main repo

This gives Tom live log visibility while Claude has passive read access. Tom controls the pacing.

## Files NOT to Touch
- `service-account.json` — Google credentials, in .gitignore
- `.env` — secrets, in .gitignore

## Job ID
Currently hardcoded as `JOB-DEMO-001` — needs to be dynamic for production.
