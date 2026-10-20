# Web Provider Capability & Truth Probe: ChatGPT Web (`chatgpt`)

**Ticket ID:** `P9-CG7`  
**Provider Name:** ChatGPT Web (OpenAI)  
**Assigned Orchestration Role:** `LEADER` / `ARCHITECT`  
**Partition:** `persist:mcb-web-chatgpt`  
**Primary Origin:** `https://chatgpt.com`  
**Date Audited:** 2026-10-20  
**Verification Level:** `MANUAL_ASSISTED` / `AUTO_VERIFIED_PROVENANCE`  
**Cost Invariant:** **$0.00 / 0đ Zero-Cost Verified** (Zero API keys, zero paid endpoints)

---

## 1. Approved Origins & Auth Mechanisms

- **Primary URL:** `https://chatgpt.com/`
- **Thread URL Format:** `https://chatgpt.com/c/<uuid>` (Reopenable: YES)
- **Approved Auth Origins:**
  - `https://chatgpt.com`
  - `https://auth.openai.com`
  - `https://auth0.openai.com`
  - `https://platform.openai.com`
  - `https://accounts.google.com` (Google SSO)
  - `https://appleid.apple.com` (Apple SSO)
  - `https://login.microsoftonline.com` (Microsoft SSO)
  - `https://login.live.com` (Microsoft Live SSO)
- **Authentication Lifecycle:**
  - Interactive login performed inside partition `persist:mcb-web-chatgpt`.
  - Credentials and session cookies persist strictly inside Electron partitioned profile.
  - Zero plaintext credential extraction into local logs or workspace DB.

---

## 2. Capability Matrix & Modality Fidelity

| Modality | Level | Verification Method | Known Boundary / Fallback |
| :--- | :--- | :--- | :--- |
| **Text Generation** | `AUTO_VERIFIED` | In-session rendering & extraction | Extracts selection or completed turn markdown |
| **Native Thread Ref** | `AUTO_VERIFIED` | Regex extraction of `/c/<uuid>` | Sets `isReopenable: true` with canonical URL |
| **Image & File Share**| `MANUAL_ASSISTED`| File upload / download via workspace | Canonical boundary verified (`assertCanonicalWorkspacePath`), max 100MB |
| **Code Formatting** | `AUTO_VERIFIED` | Markdown fenced code blocks | Preserved with language identifier in `MessagePart` |
| **Deep Reasoning** | `MANUAL_ASSISTED`| O1 / Thought reasoning toggle | User interactive selection in browser tab |
| **DOM Automation** | `LIMITED` | Manual share & provenance injection| DOM selectors change frequently; fallback to assisted share |

---

## 3. Failure Detection & Health Signals (P9-XX5)

1. **Cloudflare / Turnstile Captcha:**
   - Detects `challenges.cloudflare.com` or title `Just a moment...`.
   - Fail-closed: emits `ERR_PROVIDER_CAPTCHA`, updates authStatus to `CHALLENGE_REQUIRED`.
   - Never loops or pretends reply succeeded.
2. **Session Expiry / Auth Required:**
   - Detects redirect to `auth.openai.com` or `/login`.
   - Emits `ERR_PROVIDER_AUTH_REQUIRED`, updates authStatus to `LOGIN_REQUIRED`.
3. **Usage Limit / Quota Exceeded:**
   - Detects HTTP 429 or text: `"You have reached your limit of messages for GPT-4"`.
   - Emits `ERR_PROVIDER_QUOTA_EXCEEDED`, stops dispatch without blind retries.
4. **Service Outage:**
   - Detects HTTP 502/503 or `"Service is currently unavailable"`.
   - Emits `ERR_PROVIDER_SERVICE_UNAVAILABLE`.

---

## 4. Policy & Zero-Cost Guard Compliance

- **Cost Guard:** Network filter completely drops any egress to `api.openai.com` (Fail-closed).
- **Zero Scraping Policy:** Content is captured via verified user selection or explicit user export, tagged with `USER_MANUAL` or `LIVE_WEB` provenance and backend session identity `wps_chatgpt_*`.
