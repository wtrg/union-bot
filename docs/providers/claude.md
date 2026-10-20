# Web Provider Capability & Truth Probe: Claude Web (`claude`)

**Ticket ID:** `P9-CL7`  
**Provider Name:** Claude Web (Anthropic)  
**Assigned Orchestration Role:** `REVIEWER` / `ARCHITECT`  
**Partition:** `persist:mcb-web-claude`  
**Primary Origin:** `https://claude.ai`  
**Date Audited:** 2026-10-20  
**Verification Level:** `MANUAL_ASSISTED` / `AUTO_VERIFIED_PROVENANCE`  
**Cost Invariant:** **$0.00 / 0đ Zero-Cost Verified** (Zero API keys, zero paid endpoints)

---

## 1. Approved Origins & Auth Mechanisms

- **Primary URL:** `https://claude.ai/`
- **Thread URL Format:** `https://claude.ai/chat/<uuid>` (Reopenable: YES)
- **Approved Auth Origins:**
  - `https://claude.ai`
  - `https://anthropic.com`
  - `https://accounts.google.com` (Google SSO)
  - `https://appleid.apple.com` (Apple SSO)
- **Authentication Lifecycle:**
  - Email link / Google OAuth login inside partition `persist:mcb-web-claude`.
  - Credentials persist strictly in isolated session profile.
  - Zero plaintext credential extraction.

---

## 2. Capability Matrix & Modality Fidelity

| Modality | Level | Verification Method | Known Boundary / Fallback |
| :--- | :--- | :--- | :--- |
| **System Architecture**| `AUTO_VERIFIED` | Deep technical reasoning reviews | Artifacts formatted as structured Markdown |
| **Artifacts Canvas** | `MANUAL_ASSISTED`| Claude interactive Artifacts | Code/HTML canvas viewed natively; exported via workspace |
| **Native Thread Ref** | `AUTO_VERIFIED` | Regex extraction of `/chat/<uuid>` | Sets `isReopenable: true` with canonical URL |
| **Long Context Docs** | `MANUAL_ASSISTED`| File upload (PDF/TXT/Code) | Canonical boundary verified (`assertCanonicalWorkspacePath`), max 100MB |
| **DOM Automation** | `LIMITED` | Manual share & provenance injection| Custom web components; fallback to assisted share |

---

## 3. Failure Detection & Health Signals (P9-XX5)

1. **Cloudflare Challenge:**
   - Detects Turnstile or Cloudflare verification page.
   - Emits `ERR_PROVIDER_CAPTCHA`, updates authStatus to `CHALLENGE_REQUIRED`.
2. **Login Required:**
   - Detects redirect to `claude.ai/login`.
   - Emits `ERR_PROVIDER_AUTH_REQUIRED`, updates authStatus to `LOGIN_REQUIRED`.
3. **Usage Limit / Message Quota:**
   - Detects text: `"You are out of messages until..."` or HTTP 429.
   - Emits `ERR_PROVIDER_QUOTA_EXCEEDED` (Fail-closed, no blind loops).
4. **Service Overload:**
   - Detects HTTP 500/503 or `"Claude is currently overloaded"`.
   - Emits `ERR_PROVIDER_SERVICE_UNAVAILABLE`.

---

## 4. Policy & Zero-Cost Guard Compliance

- **Cost Guard:** Network filter completely cancels any calls to `api.anthropic.com` (Fail-closed).
- **Backend Session Identity:** Tagged with `wps_claude_*` and role `REVIEWER` / `ARCHITECT`.
