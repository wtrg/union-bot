# UNION BOT V4 — PROVIDER CAPABILITY & RUNTIME TRUTH MATRIX (U00-003)

**Audit Date:** 2026-10-21T04:54:30+07:00  
**Enforcement Policy:** Zero Cost ($0.00), Truthful Badges (No fake green 'Ready'), No Mock-Live Substitution.

| Provider | Transport Mode | Runtime Verification | Current Auth State | Automation Level | Quota / Cost Signal | Action When Blocked |
|---|---|---|---|---|---|---|
| **ChatGPT Web** | `NATIVE_WEB_SESSION_ASSISTED` | Active browser session in `genvideo-browser` tab 0 | `AUTHENTICATED` | `ASSISTED_REVIEW_AVAILABLE` | Zero cost (Web session) | Fallback to `reports/v4/review-packets/` |
| **Codex Native** | `NATIVE_CLI_RPC` | Local app-server stdio JSON-RPC | `UNAVAILABLE_IN_SESSION` | `PENDING_INDEPENDENT_QA` | $0.00 | Mark `PENDING_INDEPENDENT_QA`, do not mock |
| **Antigravity Native** | `NATIVE_CLI_RPC` | Local `agy` CLI 1.4.2 | `LOCAL_ONLY` | `FREE_LOCAL_RUNNER` | $0.00 (Zero paid API) | Restrict to deterministic local tasks |
| **Google Gemini Web** | `NATIVE_WEB_SESSION_ASSISTED` | Electron WebContentsView partition `persist:mcb-gemini` | `CHALLENGE_OR_UNVERIFIED` | `READY_MANUAL` | Unknown | Open in system browser / assisted handoff |
| **Claude Web** | `NATIVE_WEB_SESSION_ASSISTED` | Electron WebContentsView partition `persist:mcb-claude` | `CHALLENGE_OR_UNVERIFIED` | `READY_MANUAL` | Unknown | Open in system browser / assisted handoff |
| **DeepSeek Web** | `NATIVE_WEB_SESSION_ASSISTED` | Electron WebContentsView partition `persist:mcb-deepseek` | `CHALLENGE_OR_UNVERIFIED` | `READY_MANUAL` | Unknown | Open in system browser / assisted handoff |

## Invariants:
1. `SURFACE_LOADED` must never be displayed as `READY_AUTOMATED`.
2. Cloudflare challenges must display `CHALLENGE_REQUIRED` badge.
3. Automated send/receive is only claimed when `requestId <-> turnRef <-> reply` matches with cryptographic or observable proof.
