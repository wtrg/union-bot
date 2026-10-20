# Web Provider Capability & Truth Probe: Google Gemini (`gemini`)

**Ticket ID:** `P9-GM7`  
**Provider Name:** Google Gemini (Google DeepMind)  
**Assigned Orchestration Role:** `RESEARCHER` / `MULTIMODAL_ANALYST`  
**Partition:** `persist:mcb-web-gemini`  
**Primary Origin:** `https://gemini.google.com`  
**Date Audited:** 2026-10-20  
**Verification Level:** `MANUAL_ASSISTED` / `AUTO_VERIFIED_PROVENANCE`  
**Cost Invariant:** **$0.00 / 0đ Zero-Cost Verified** (Zero API keys, zero paid endpoints)

---

## 1. Approved Origins & Auth Mechanisms

- **Primary URL:** `https://gemini.google.com/app`
- **Thread URL Format:** `https://gemini.google.com/app/<id>` (Reopenable: YES)
- **Approved Auth Origins:**
  - `https://gemini.google.com`
  - `https://accounts.google.com` (Google Account OAuth)
  - `https://myaccount.google.com`
  - `https://policies.google.com`
  - `https://support.google.com`
- **Authentication Lifecycle:**
  - In-session Google Login within partition `persist:mcb-web-gemini`.
  - Passkey / 2FA popups handled inside partitioned WebContentsView.
  - No credential or cookie extraction to disk.

---

## 2. Capability Matrix & Modality Fidelity

| Modality | Level | Verification Method | Known Boundary / Fallback |
| :--- | :--- | :--- | :--- |
| **Multimodal Vision** | `AUTO_VERIFIED` | Native image upload in tab | Image bytes hashed (SHA256) and contained in workspace CAS |
| **Web Research** | `AUTO_VERIFIED` | Google Grounding search integration | Extracted citations labeled with source URLs |
| **Native Thread Ref** | `AUTO_VERIFIED` | Regex extraction of `/app/<id>` | Sets `isReopenable: true` with canonical URL |
| **Export to Docs** | `MANUAL_ASSISTED`| "Export to Docs" / "Draft in Gmail" | User initiates native export, shares link back to Union Bot |
| **DOM Automation** | `LIMITED` | Manual share & provenance injection| Google dynamic shadow DOM changes; fallback to assisted share |

---

## 3. Failure Detection & Health Signals (P9-XX5)

1. **Authentication Required:**
   - Detects redirect to `accounts.google.com`.
   - Emits `ERR_PROVIDER_AUTH_REQUIRED`, updates authStatus to `LOGIN_REQUIRED`.
2. **Quota / Rate Limit:**
   - Detects HTTP 429 or rate exhaustion notifications.
   - Emits `ERR_PROVIDER_QUOTA_EXCEEDED` (Fail-closed).
3. **Outage / Maintenance:**
   - Detects HTTP 500/502/503 or `"Experiencing high traffic"`.
   - Emits `ERR_PROVIDER_SERVICE_UNAVAILABLE`.

---

## 4. Policy & Zero-Cost Guard Compliance

- **Cost Guard:** Network filter completely cancels any calls to `generativelanguage.googleapis.com` (Fail-closed).
- **Backend Session Identity:** Tagged with `wps_gemini_*` and role `RESEARCHER`.
