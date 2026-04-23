# Chrome Web Store Submission Checklist (iApply)

Last updated: 18 April 2026

## 1) Pre-submit code checks

- Manifest version is MV3.
- No `debugger` permission in manifest.
- `web_accessible_resources` is restricted to iApply domains (not `<all_urls>`).
- `content_security_policy` for extension pages is explicit.
- Required icons exist: 16, 32, 48, 128.
- Extension runs without syntax/runtime errors in popup and background service worker.

## 2) Permissions justification (prepare for listing)

- `storage`: persist auth/session/settings.
- `tabs`: interact with LinkedIn tab and status.
- `activeTab`: user-initiated tab interaction scope.
- `scripting`: inject/ensure content script on LinkedIn.

Host permissions:
- `https://www.linkedin.com/*`: automation target.
- `https://iapply-telegram-bot.onrender.com/*`: iApply backend API.
- `https://generativelanguage.googleapis.com/*`: Gemini provider support.
- `https://api.anthropic.com/*`: Anthropic provider support.
- `https://api.openai.com/*`: OpenAI-compatible provider support.

## 3) Privacy & disclosure

- Publish a public HTTPS privacy policy URL.
- Use `PRIVACY_POLICY.md` content as base and adapt contact details.
- In CWS privacy section, disclose:
  - Authentication/session tokens (stored locally)
  - LinkedIn page content processing for automation
  - Logs/screenshots when requested by user or active automation
  - Optional LLM provider data transfer based on user-selected provider

## 4) Store listing assets

Prepare:
- Extension name, short description, detailed description.
- Screenshots of popup + active automation flow.
- 128x128 icon (already present).
- Category, language, support email/URL.

## 5) Packaging and upload

From repository root:

```bash
cd extension
zip -r ../iapply-extension-v1.0.1.zip . -x "*.DS_Store" -x "*/.DS_Store"
```

Upload `iapply-extension-v1.0.1.zip` in Chrome Developer Dashboard.

## 6) Manual QA before publish

- Sign in from popup works and stores account state.
- Start/stop agent from popup works.
- Screenshot request works when LinkedIn tab is visible.
- Telegram command polling/start/stop still works.
- No console errors in service worker during normal flow.

## 7) Post-upload notes

If Chrome review requests reduced scope:
- Consider removing unused provider host permissions if you decide to support fewer providers in extension UI.
- Consider proxying LLM calls through backend to reduce direct third-party host permissions.
