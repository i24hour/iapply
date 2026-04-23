# iApply Chrome Extension Privacy Policy

Last updated: 18 April 2026

## 1) What this extension does

iApply helps users automate parts of LinkedIn job application workflows and post outreach actions.

Core features include:
- Starting/stopping job automation from extension popup, web dashboard, or Telegram.
- Reading LinkedIn page content to decide navigation/form actions.
- Capturing screenshots/frames for live monitoring (when available).
- Sending automation logs and usage events to iApply backend.

## 2) Data we process

The extension may process the following categories of data:
- Authentication data: Supabase access token and refresh token.
- Account metadata: user id and email (for account linking).
- User settings: selected model/provider, API key, search query, outreach settings.
- Page interaction data: LinkedIn page text, form labels, and interactive element metadata required to automate actions.
- Generated artifacts: screenshots/capture frames requested by the user or generated during active runs.
- Usage telemetry: task status, token usage, model metadata, and limited diagnostics.

## 3) How data is used

Data is used only to provide the requested automation functionality:
- Authenticate and link extension to the user account.
- Execute automation commands and maintain session state.
- Track progress and show logs in popup/dashboard/Telegram.
- Compute usage and model-cost analytics.

## 4) Data sharing

Data is sent to:
- iApply backend API: https://iapply-telegram-bot.onrender.com
- LLM providers chosen by the user in extension settings:
  - Google Gemini API
  - Anthropic API
  - OpenAI-compatible API

iApply does not sell personal data.

## 5) Storage and retention

- Extension stores auth/session/settings in Chrome extension local storage.
- Backend retention depends on iApply server/database policies.
- Users can sign out from extension popup to remove local auth tokens.

## 6) Security

- Authentication requests use HTTPS endpoints.
- Extension uses Chrome Manifest V3 service worker architecture.
- Access is limited to declared permissions and host permissions.

## 7) User controls

Users can:
- Stop automation anytime.
- Sign out from extension popup.
- Change provider/model/API key settings.
- Remove extension to delete local extension data.

## 8) Contact

For privacy questions, contact the iApply support/contact channel used for your deployment.

---

Note: For Chrome Web Store submission, host this policy at a public HTTPS URL and use that URL in the listing.