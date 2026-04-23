# iApply Master Technical Document (ALL)

Last updated: 18 April 2026

This document is a complete technical walkthrough of the current iApply codebase, including web app, backend, extension, AI service, shared types, and Supabase schema/migrations.

It is written as the single master reference for product features, runtime flows, and release readiness.

---

## 1) Product Overview

iApply is an automation platform for job applications and outreach centered around LinkedIn.

Main capabilities:
- User authentication and account linking (web + extension + Telegram).
- Resume upload and parsing.
- Profile and preferences management.
- Job automation orchestration (start/pause/stop/status).
- Browser extension agent with DOM snapshot + LLM decision loop.
- Post outreach mode for LinkedIn feed engagement.
- Telegram bot control and live log forwarding.
- Usage and token/cost tracking.
- Tailored resume generation (DOCX) per role/job context.

Tech stack summary:
- Frontend: Next.js 16 + React 18 + Zustand + Tailwind.
- Backend API: Express + Supabase + Zod + Telegram bot.
- AI service: FastAPI + OpenAI SDK + PDF/DOCX parsers.
- Extension: Chrome Manifest V3 (service worker + content script + popup).
- Data: Supabase Postgres with RLS policies via SQL migrations.

---

## 2) Monorepo Structure and Responsibility

Top-level folders:
- `client`: Next.js dashboard UI and chat control surface.
- `server`: API, Telegram bridge, usage tracking, resume storage/generation.
- `extension`: Chrome extension automation runtime.
- `ai-service`: Python APIs for resume parsing/matching/answering.
- `shared`: shared TypeScript types and helpers.
- `supabase/migrations`: SQL schema and policies.
- `RAW_IAPPLY`: documentation output (this file).

Root scripts (`package.json`):
- `npm run dev`: runs backend + client concurrently.
- `npm run dev:server`: `tsx server/src/index.ts`.
- `npm run dev:client`: Next dev server.
- `npm run install:all`: installs root/client/server dependencies.

---

## 3) Frontend (client) Deep Dive

### 3.1 App shell and routing

- `client/src/app/layout.tsx`
  - Global app layout.
  - Uses `ThemeProvider` + `react-hot-toast` toaster.

- `client/src/app/page.tsx`
  - Entry router.
  - Handles hash token handoff (`/auth/success`) and extension return_to redirects.
  - Sends authenticated users to `/dashboard`, others to `/login`.

- `client/src/app/auth/success/page.tsx`
  - Final auth completion page.
  - Reads token from hash/query, verifies via `/auth/me`, persists auth store.
  - Handles Telegram linking completion path and extension `return_to` path.

- `client/src/app/login/page.tsx`
  - Login UI with Google OAuth and email/password form.
  - Supports Telegram context (`telegram_id`) and extension callback (`return_to`).
  - If already authenticated and extension return target exists, redirects back to extension callback URL.

- `client/src/app/signup/page.tsx`
  - Signup UI with full name/email/password.
  - Supports Telegram and extension return flow.

- `client/src/app/dashboard/layout.tsx`
  - Sidebar + navigation shell.
  - Guards unauthenticated access.
  - Includes theme switch and user panel.

- `client/src/app/dashboard/page.tsx`
  - Dashboard chat view host.
  - Preloads status, recent apps, resume, profile.
  - Polls automation status every 5 seconds while running.

### 3.2 Dashboard pages

- `dashboard/profile/page.tsx`
  - Reads and updates profile.
  - Allows editing name, phone, location, years of experience, skills, preferred roles.
  - Pre-fills from parsed resume if profile not present.

- `dashboard/resume/page.tsx`
  - Drag-and-drop upload (`react-dropzone`) for PDF/DOCX up to 5MB.
  - Calls `/resume/upload`, shows parsed data preview.

- `dashboard/preferences/page.tsx`
  - Manages roles, locations, remote-only, experience level, job types, salary bounds.
  - Saves with `/preferences` update.

- `dashboard/applications/page.tsx`
  - Paginated application list.
  - Local filtering by status/search.
  - Desktop table + mobile cards.

- `dashboard/usage/page.tsx`
  - Fetches `/usage/tasks` and aggregates tokens/cost.
  - Displays task-level source/model/status/cost details.

### 3.3 Chat and control components

- `client/src/components/chat-bot.tsx`
  - Primary command interface.
  - Parses user text into command intents (`parseCommand`).
  - Supports modes: `easy`, `apply`, `easy_jd_resume`.
  - Sends start/pause/stop/status and extension control commands.
  - Pulls live feed from `/agent/live` every 4s.
  - Displays:
    - extension logs
    - latest screenshots
    - recording timeline frames
    - generated-resume session entries (`JD_RESUME_READY::` marker parsing)
  - Supports commands like:
    - `easy apply 5 jobs`
    - `apply 10 jobs based on my profile`
    - `status`
    - `screenshot`
    - `start recording`
    - `stop recording`
    - `click not now`

- `automation-control.tsx`
  - Compact start/pause/stop widget.

- `quick-setup.tsx`
  - Setup checklist for missing resume/profile.

- `recent-applications.tsx`
  - Recent application summary list.

- `right-sidebar.tsx` + `stats-card.tsx`
  - Stats panel + premium placeholder card.

### 3.4 Frontend state and API layer

- `stores/auth-store.ts`
  - Persisted auth state with token in localStorage.

- `stores/dashboard-store.ts`
  - Profile, resume, preferences, automation status, applications.

- `stores/chat-store.ts`
  - Chat message history and helpers.

- `lib/api.ts`
  - Axios base client with auth interceptor.
  - Auto unwraps backend envelope `{ success, data }`.
  - APIs grouped: auth/profile/resume/preferences/automation/extension/applications/usage.

- `lib/extension-auth.ts`
  - Securely stores/reads `return_to` extension callback target in sessionStorage.

Important note:
- Client `authApi.login/signup` exists, but backend route file currently exposes OAuth-oriented auth routes (`/google`, `/callback`, `/me`, etc.). This indicates either legacy client methods or missing backend email auth endpoints in current code.

---

## 4) Backend (server) Deep Dive

### 4.1 Server bootstrap and middleware

- `server/src/index.ts`
  - Loads env from multiple fallback paths.
  - Configures CORS with:
    - configured client origins
    - localhost fallback
    - `chrome-extension://` origins allowed.
  - Mounts routes:
    - `/auth`
    - `/profile`
    - `/resume`
    - `/preferences`
    - `/automation`
    - `/applications`
    - `/extension`
    - `/agent`
    - `/usage`
  - Starts Telegram bot if `TELEGRAM_BOT_TOKEN` present.

- `middleware/auth.ts`
  - Verifies bearer token via Supabase auth (`supabase.auth.getUser`).

- `middleware/error-handler.ts`
  - Standard JSON error formatter.

### 4.2 Auth routes (`routes/auth.ts`)

Main endpoints:
- `GET /auth/google`
  - Starts Supabase Google OAuth.
  - Supports `telegram_id` and extension `return_to`.

- `GET /auth/callback`
  - Exchanges code for session.
  - Upserts user in `public.users`.
  - Optionally links Telegram chat id.
  - Redirects to:
    - Telegram deep link, or
    - extension callback hash URL, or
    - web auth success route.

- `GET /auth/me`
  - Returns authenticated user metadata.

- `POST /auth/link-telegram`
  - Links Telegram chat id to current user.

- `POST /auth/refresh`
  - Refreshes access token using refresh token (used by extension).

- `POST /auth/verify`
  - Token verification endpoint (used by extension callback/popup).

### 4.3 Core domain routes

- `routes/profile.ts`
  - `GET /profile`, `PUT /profile` (upsert by `user_id`).

- `routes/preferences.ts`
  - `GET /preferences`, `PUT /preferences` (upsert by `user_id`).

- `routes/applications.ts`
  - `GET /applications` paginated.
  - `GET /applications/:id` per-item lookup.

- `routes/resume.ts`
  - `GET /resume/all`: all resumes for user.
  - `GET /resume`: latest resume.
  - `POST /resume/upload`: multer upload + optional AI parse call.
  - `POST /resume/generate`: builds tailored DOCX and stores metadata row.
  - `GET /resume/:id/file`: streams/downloads stored resume binary.

### 4.4 Automation and extension routes

- `routes/automation.ts`
  - `GET /automation/status`: running state + aggregate counts.
  - `POST /automation/start`: inserts `agent_sessions` with payload JSON and creates task run.
  - `POST /automation/pause` and `POST /automation/stop`: stop sessions, stop open tasks, enqueue stop command.

- `routes/extension.ts`
  - `GET /extension/commands`: extension polling for pending frontend sessions; marks as running.
  - `POST /extension/commands/:id/complete`: marks session stopped + task completed.
  - `POST /extension/jobs`: upserts jobs and creates pending applications.
  - `POST /extension/application`: updates application result + screenshot storage + Telegram success message.
  - `GET /extension/jobs/pending`: next pending job payloads.

- `routes/telegram-bridge.ts` mounted at `/agent`
  - Extension command queue polling: `/agent/poll`, `/agent/complete/:id`.
  - Log/status/reporting: `/agent/log`, `/agent/status`.
  - Manual controls: `/agent/request-screenshot`, `/agent/manual-click`.
  - Recording controls: `/agent/start-recording`, `/agent/stop-recording`, `/agent/recording-status`.
  - Capture ingestion: `/agent/screenshot`, `/agent/capture`.
  - Frontend live feed: `/agent/live`.

- `routes/usage.ts`
  - `POST /usage/tasks`: create task run.
  - `POST /usage/llm`: usage event ingestion.
  - `POST /usage/tasks/:id/status`: task status updates.
  - `GET /usage/tasks`: list task history.

### 4.5 Backend libraries

- `lib/supabase.ts`
  - Supabase service-role client.
  - user upsert + Telegram linking utilities.

- `lib/agent-commands.ts`
  - In-memory per-user command queue + logs + status/recording state.

- `lib/telegram.ts`
  - Telegram bot lifecycle and command handling.
  - Supports direct command parsing and LLM intent classification fallback.
  - Forwards extension logs to Telegram chat.

- `lib/usage-tracking.ts`
  - Task creation/status updates.
  - LLM usage event insertion + task-level aggregate token/cost updates.

- `lib/model-pricing.ts`
  - Pricing rules (Gemini variants currently configured) and cost calculation.

- `lib/resume-docx-generator.ts`
  - Programmatic DOCX resume generation with sections:
    - Summary
    - Skills
    - Work Experience
    - Education
    - Job Fit Notes (if JD present)

- `lib/resume-storage.ts`
  - Save/load resume binaries from:
    - local disk (`/uploads/resumes`) or
    - S3 (`s3://...`) when configured.

Note:
- `server/prisma/schema.prisma` defines domain models but runtime data access currently uses Supabase client queries directly (not Prisma query runtime paths).

---

## 5) AI Service (ai-service) Deep Dive

- `main.py`
  - FastAPI app setup with CORS for local frontend/backend.
  - `/health` endpoint.

- `api/routes.py`
  - `POST /parse-resume`:
    - decodes base64 file, writes temp file, parses PDF/DOCX, returns structured resume object.
  - `POST /match-job`:
    - computes score + reasons from profile/job.
  - `POST /generate-answer`:
    - generates answer for application question.

- `resume_parser/parser.py`
  - Text extraction:
    - PDF via `pdfplumber`
    - DOCX via `python-docx`
  - LLM parse path using OpenAI (`gpt-3.5-turbo`) if `OPENAI_API_KEY` exists.
  - Regex fallback parser if key missing or LLM parse fails.

- `form_answering/generator.py`
  - Rule-based handling for common forms (yes/no, salary skip, notice period, experience years, etc.).
  - Option selector logic for dropdown/radio.
  - AI freeform answer generation fallback using OpenAI.

- `job_matcher/scorer.py`
  - Weighted scoring model:
    - skill overlap
    - preferred role overlap
    - experience-level heuristics.

---

## 6) Extension Deep Dive

### 6.1 Manifest and packaging

Current manifest (`extension/manifest.json`):
- Manifest v3.
- Popup UI + service worker background.
- LinkedIn content script.
- Permissions:
  - `storage`, `tabs`, `activeTab`, `scripting`
- Host permissions:
  - LinkedIn
  - iApply backend
  - Gemini, Anthropic, OpenAI APIs
- CSP explicitly set for extension pages.
- Web-accessible auth callback restricted to iApply domains.

### 6.2 Popup (`popup/popup.html`, `popup/popup.js`)

Features:
- Account auth card (sign in/out, token verify, refresh support).
- LLM configuration (provider, api key, model, base URL).
- Agent mode switching:
  - job_apply
  - post_outreach
- Start/stop controls for both job scraper and post outreach.
- Local log feed rendering and status indicators.

### 6.3 Background service worker (`background/service-worker.js`)

Responsibilities:
- Command orchestration from:
  - popup runtime messages
  - frontend API polling (`/extension/commands`)
  - Telegram bridge polling (`/agent/poll`)
- Resume selection preflight via backend resume list and intent scoring.
- Recording and capture upload loop (`/agent/capture`, `/agent/screenshot`).
- Extension log fanout:
  - popup
  - backend `/agent/log`
- Start pipeline cancellation guards and duplicate frontend command suppression.

Important runtime loops:
- Telegram/front-end polling interval: every 5 seconds.
- Recording capture interval: every 15 seconds.

### 6.4 Agent core (`background/agent-core.js`)

Core automation engine:
- State machine from `IDLE` to active run loops.
- LLM action planning against DOM snapshots.
- Provider adapters:
  - Gemini
  - Anthropic
  - OpenAI-compatible
- Progress control for Easy Apply flow:
  - open next candidate
  - detect modal
  - fill/validate
  - submit and close success modal
- Resume logic:
  - deterministic selection + intent/disallowed-token checks
  - generated resume upload path for JD resume mode
- Anti-stuck and recovery:
  - repeated action detection
  - page signature stagnation checks
  - deterministic recovery actions and validation fixes

### 6.5 Content script (`content/linkedin.js`)

Executes page-level automation actions and extraction:
- DOM snapshot builder with interactive element map.
- Job context extraction (including enriched/expanded description).
- Easy Apply modal operations:
  - resume selection verification
  - generated resume upload
  - validation fixes
  - execute decision actions (`click`, `type`, `clear_and_type`, `select_option`, `pressEnter`).
- Manual click by text handler.
- Post outreach engine:
  - feed post scan
  - relevance scoring by title/keywords
  - CTA detection (`comment interested`, email/portfolio asks)
  - comment submission with fallback paths

### 6.6 Extension auth callback

- `auth/callback.html` + `auth/callback.js`
  - Reads token from URL hash.
  - Verifies token with backend.
  - Stores extension auth state in `chrome.storage.local`.
  - Sends token to service worker.

---

## 7) Shared Types (shared)

- `shared/src/types.ts`
  - canonical interfaces for:
    - auth/user
    - profile/resume/preferences
    - jobs/applications
    - automation and extension payloads
    - AI requests/responses.

- `shared/src/index.ts`
  - exports type constants and utility validators.

---

## 8) Database Schema and Policies (supabase/migrations)

### 001_initial_schema.sql
- Creates `users` linked to `auth.users`.
- Creates `agent_sessions` table.
- Adds trigger for auto-user sync from auth signup.
- Enables RLS and owner-select/update policies.

### 002_usage_tracking.sql
- Creates `task_runs` and `llm_usage_events`.
- Adds indexes for user/time and task lookups.
- Enables RLS for per-user select/insert/update.

### 003_app_domain_tables.sql
- Creates:
  - `profiles`
  - `resumes`
  - `job_preferences`
  - `jobs`
  - `applications`
- Adds update timestamp trigger function.
- Adds RLS policies for per-user tables.
- Adds permissive authenticated policies for `jobs` reads/inserts/updates.

### 004_agent_sessions_update_policy.sql
- Adds explicit `UPDATE` policy for own `agent_sessions` rows.

---

## 9) End-to-End Runtime Flows

### Flow A: Web auth and dashboard
1. User opens web app.
2. Login/signup routes handle OAuth and optional Telegram/extension context.
3. Token stored client-side.
4. Dashboard loads status + apps + profile + resume.
5. Chat commands call backend automation/agent APIs.

### Flow B: Extension auth handshake
1. Popup `Sign In` opens web `/login?return_to=chrome-extension://.../auth/callback.html`.
2. Web auth completes and redirects back with hash tokens.
3. Callback verifies token and stores extension auth keys.
4. Service worker receives token and starts polling APIs.

### Flow C: Frontend command -> extension run
1. Dashboard `apply` command creates `agent_session` via `/automation/start`.
2. Service worker polls `/extension/commands` and receives session payload.
3. Agent starts with config + selected resume context.
4. Live logs/captures flow to `/agent/log` and `/agent/capture`.
5. Completion endpoint marks session/task complete.

### Flow D: Telegram command -> extension run
1. Telegram bot parses command (direct patterns or Gemini classifier fallback).
2. Enqueues in in-memory command queue.
3. Service worker polls `/agent/poll`, executes command.
4. Logs and status updates forwarded back to Telegram user.

### Flow E: Resume upload and generation
1. Resume upload to backend (`/resume/upload`).
2. AI service parse call extracts structured fields.
3. Parsed data stored in `resumes`; profile upserted.
4. Generated resume request (`/resume/generate`) creates tailored DOCX + metadata row.

---

## 10) Chrome Web Store Preparation Status

### Changes applied now
- Removed `debugger` permission from manifest.
- Removed debugger-based screenshot fallback code from service worker.
- Screenshot pipeline now relies on visible-tab capture only.
- Added explicit extension page CSP in manifest.
- Restricted `web_accessible_resources` matches from `<all_urls>` to iApply domains.
- Added `short_name`, `minimum_chrome_version`, and bumped extension version to `1.0.1`.
- Added publish docs:
  - `extension/PRIVACY_POLICY.md`
  - `extension/CHROME_WEB_STORE_CHECKLIST.md`

### Remaining steps before upload
- Host privacy policy at a public HTTPS URL and use it in CWS listing.
- Fill permission justifications clearly in listing form.
- Capture store screenshots and finalize listing metadata.
- Zip extension and upload package.

---

## 11) Environment and Deployment Notes

### Backend expected envs (from render + code)
- `PORT`, `NODE_ENV`
- `CLIENT_URL`, `APP_URL`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `GEMINI_API_KEY`
- Optional AWS S3 creds for resume storage.

### Frontend expected env
- `NEXT_PUBLIC_API_URL`

### AI service expected env
- `OPENAI_API_KEY` (optional but needed for LLM parse/generation paths)

---

## 12) Known Gaps / Risks Worth Tracking

- Client has email/password auth methods pointing to `/auth/login` and `/auth/signup` while current backend auth route is OAuth-centric. Confirm intended auth strategy and remove dead paths or add endpoints.
- Extension screenshot quality depends on LinkedIn tab visibility in its window after debugger fallback removal.
- Extension directly calls third-party LLM APIs from browser context; this requires strong disclosure and careful key handling.
- `server/prisma/schema.prisma` and Supabase SQL can drift if maintained separately; ensure one source-of-truth governance.

---

## 13) Quick File Index (Most Critical)

Frontend:
- `client/src/components/chat-bot.tsx`
- `client/src/app/auth/success/page.tsx`
- `client/src/lib/api.ts`

Backend:
- `server/src/index.ts`
- `server/src/routes/automation.ts`
- `server/src/routes/extension.ts`
- `server/src/routes/telegram-bridge.ts`
- `server/src/lib/telegram.ts`
- `server/src/lib/usage-tracking.ts`

Extension:
- `extension/manifest.json`
- `extension/background/service-worker.js`
- `extension/background/agent-core.js`
- `extension/content/linkedin.js`
- `extension/popup/popup.js`

AI Service:
- `ai-service/api/routes.py`
- `ai-service/resume_parser/parser.py`
- `ai-service/form_answering/generator.py`

Database:
- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/002_usage_tracking.sql`
- `supabase/migrations/003_app_domain_tables.sql`
- `supabase/migrations/004_agent_sessions_update_policy.sql`

---

This ALL document is now the canonical high-detail reference for your current repository behavior and release readiness.