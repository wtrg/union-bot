# Web Provider Capability & Truth Probe: DeepSeek Web (`deepseek`)

**Ticket ID:** `P9-DS7`  
**Provider Name:** DeepSeek Web (DeepSeek AI)  
**Assigned Orchestration Role:** `REVIEWER` / `ALGORITHM_OPTIMIZER`  
**Partition:** `persist:mcb-web-deepseek`  
**Primary Origin:** `https://chat.deepseek.com`  
**Date Audited:** 2026-10-20  
**Verification Level:** `MANUAL_ASSISTED` / `AUTO_VERIFIED_PROVENANCE`  
**Cost Invariant:** **$0.00 / 0đ Zero-Cost Verified** (Zero API keys, zero paid endpoints)

---

## 1. Approved Origins & Auth Mechanisms

- **Primary URL:** `https://chat.deepseek.com/`
- **Thread URL Format:** `https://chat.deepseek.com/chat/<id>` (Reopenable: YES)
- **Approved Auth Origins:**
  - `https://chat.deepseek.com`
  - `https://deepseek.com`
  - `https://auth.deepseek.com`
- **Authentication Lifecycle:**
  - Email/password or SMS login inside partition `persist:mcb-web-deepseek`.
  - Credentials persist strictly in isolated session profile.
  - Zero plaintext credential extraction.

---

## 2. Capability Matrix & Modality Fidelity

| Modality | Level | Verification Method | Known Boundary / Fallback |
| :--- | :--- | :--- | :--- |
| **Code Optimization** | `AUTO_VERIFIED` | Deep algorithmic analysis & audits | Preserved as syntax-highlighted code blocks |
| **Math / Reasoning** | `AUTO_VERIFIED` | DeepSeek-R1 CoT verification | Extracted with KaTeX/LaTeX formatting |
| **Native Thread Ref** | `AUTO_VERIFIED` | Regex extraction of `/chat/<id>` | Sets `isReopenable: true` with canonical URL |
| **File Attachments** | `MANUAL_ASSISTED`| File upload via web interface | Canonical boundary verified (`assertCanonicalWorkspacePath`), max 100MB |
| **DOM Automation** | `LIMITED` | Manual share & provenance injection| Custom Vue/React SPA; fallback to assisted share |

---

## 3. Failure Detection & Health Signals (P9-XX5)

1. **Captcha / Human Verification:**
   - Detects visual slider or captcha challenge.
   - Emits `ERR_PROVIDER_CAPTCHA`, updates authStatus to `CHALLENGE_REQUIRED`.
2. **Login Required:**
   - Detects redirect to `/sign_in` or `/login`.
   - Emits `ERR_PROVIDER_AUTH_REQUIRED`, updates authStatus to `LOGIN_REQUIRED`.
3. **Server Busy / Quota Exhaustion:**
   - Detects text: `"Server is busy, please try again later"` or HTTP 429.
   - Emits `ERR_PROVIDER_QUOTA_EXCEEDED` (Fail-closed).
4. **Service Outage:**
   - Detects HTTP 502 Bad Gateway or 504 Gateway Timeout.
   - Emits `ERR_PROVIDER_SERVICE_UNAVAILABLE`.

---

## 4. Policy & Zero-Cost Guard Compliance

- **Cost Guard:** Network filter completely cancels any calls to `api.deepseek.com` (Fail-closed).
- **Backend Session Identity:** Tagged with `wps_deepseek_*` and role `REVIEWER`.
