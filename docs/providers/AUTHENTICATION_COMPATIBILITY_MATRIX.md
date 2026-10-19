# Provider Authentication & In-Session Compatibility Matrix (Phase P4 Round R02)

**Document Reference:** `docs/providers/AUTHENTICATION_COMPATIBILITY_MATRIX.md`  
**Standard:** Union Bot Zero-Cost Windows 11 Desktop AI Workspace  
**Compliance Invariants:**  
1. **$0.00 Cost Guard:** Zero paid API endpoints accessed; all provider operations run through interactive web surfaces.  
2. **Strict Process & Partition Isolation:** Every provider maintains an independent Chromium session partition (`persist:mcb-web-*`).  
3. **Zero Plaintext Credential Extraction:** No credentials, tokens, or session cookies are ever extracted, scraped, or saved to local disk.  
4. **Federated OAuth In-Session Continuity:** Authentication popups and redirects for legitimate identity providers (Google, Microsoft, Apple) execute strictly within the host provider's partition, never leaking to other providers or external OS browsers unintentionally.

---

## 1. Provider Compatibility Matrix

| Provider ID | Provider Name | Session Partition | Primary Origin | Approved Identity & Auth Origins | Popup Handling Policy | Auth Status Heuristic |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `chatgpt` | ChatGPT Web | `persist:mcb-web-chatgpt` | `https://chatgpt.com` | `https://chatgpt.com`<br>`https://auth.openai.com`<br>`https://auth0.openai.com`<br>`https://platform.openai.com`<br>`https://accounts.google.com`<br>`https://appleid.apple.com`<br>`https://login.microsoftonline.com`<br>`https://login.live.com` | Allowed in same partition for approved auth domains; external links denied & routed to OS browser | Path check: `/login`, `/auth` -> `LOGIN_REQUIRED`; `chatgpt.com/?`, `chatgpt.com/c/` -> `READY_OR_LANDING` |
| `gemini` | Google Gemini | `persist:mcb-web-gemini` | `https://gemini.google.com` | `https://gemini.google.com`<br>`https://accounts.google.com`<br>`https://myaccount.google.com`<br>`https://policies.google.com`<br>`https://support.google.com` | Allowed in same partition for Google OAuth; external links denied & routed to OS browser | Path check: `accounts.google.com` -> `LOGIN_REQUIRED`; `gemini.google.com/app` -> `READY_OR_LANDING` |
| `claude` | Claude Web | `persist:mcb-web-claude` | `https://claude.ai` | `https://claude.ai`<br>`https://anthropic.com`<br>`https://accounts.google.com`<br>`https://appleid.apple.com` | Allowed in same partition for Claude & federated auth; external links denied & routed to OS browser | Path check: `/login` -> `LOGIN_REQUIRED`; `claude.ai/chats`, `claude.ai/chat/` -> `READY_OR_LANDING` |
| `deepseek` | DeepSeek Web | `persist:mcb-web-deepseek` | `https://chat.deepseek.com` | `https://chat.deepseek.com`<br>`https://deepseek.com`<br>`https://auth.deepseek.com` | Allowed in same partition for DeepSeek auth; external links denied & routed to OS browser | Path check: `/login`, `/sign_in` -> `LOGIN_REQUIRED`; `chat.deepseek.com/` (authenticated) -> `READY_OR_LANDING` |
| `search` | General Search | `persist:mcb-web-search` | `https://duckduckgo.com` | Any valid public HTTPS URL (search results & general browsing) | Blocked popups; external links open via OS safe browser | N/A (`READY_OR_LANDING`) |

---

## 2. Authentication & Navigation Boundaries (UB-P4-R01-002)

### 2.1 In-Session OAuth Federation
- When a user logs into ChatGPT using "Continue with Google", ChatGPT requests a popup or redirects to `https://accounts.google.com/...`.
- `setWindowOpenHandler` evaluates `isAllowedForProvider(providerId, url)`. Because `accounts.google.com` is in `PROVIDER_AUTH_ORIGINS['chatgpt']`, the popup is permitted to open as an attached child window that shares `session: partSession` (`persist:mcb-web-chatgpt`).
- Result: The user authenticates with Google, the OAuth redirect completes, cookies are saved in `persist:mcb-web-chatgpt`, and the session never leaves the application or leaks into `persist:mcb-web-gemini`.

### 2.2 Boundary Defense (P4-R02-T02)
- If a script or user link attempts to navigate a provider tab to an arbitrary unapproved domain (e.g. `https://untrusted-site.com` or `https://phishing.com`):
  1. `will-navigate` blocks the navigation.
  2. `safeOpenExternal()` opens the link safely in the user's default OS browser.
  3. The provider view remains at its legitimate URL.

### 2.3 Cost Guard Interception (P4-003 & P4-R02-T03)
- Under no circumstance may web provider views invoke paid API endpoints (`api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`).
- The session `webRequest.onBeforeRequest` filter intercepts all requests across all browser partitions. Any call matching `isCostGuardBlockedUrl()` is cancelled immediately (`cancel: true`).
