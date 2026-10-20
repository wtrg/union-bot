# Union Bot Provider Fidelity & Manual Acceptance Checklist

**Standard:** Master Plan V3 / V3.1 Addendum Ticket `P9-007`  
**Scope:** Verification checklist for 4 Web Providers (ChatGPT, Gemini, Claude, DeepSeek) + 2 Local Agents (Codex, Antigravity)  
**Cost Baseline:** Strict $0.00 / 0đ Zero-Cost Enforcement

---

## 1. Provider In-Session Verification Matrix

| Checklist Item | Description | Verification Criterion | Expected State |
| :--- | :--- | :--- | :--- |
| **P9-CHK-01** | **Partitioned Profile Isolation** | Launching each provider creates an isolated Chromium session directory | Pass: No shared cookies between partitions |
| **P9-CHK-02** | **OAuth In-Session Continuation** | Google/Microsoft/Apple SSO login stays inside provider partition | Pass: OAuth redirect does not escape to external browser |
| **P9-CHK-03** | **Paid API Egress Blocking** | Network requests to `api.openai.com`, `api.anthropic.com`, etc. are blocked | Pass: Status blocked (ERR_BLOCKED_BY_CLIENT / 0đ egress) |
| **P9-CHK-04** | **Backend Identity Binding** | Backend assigns authoritative session ID and role to each provider | Pass: Renderer cannot spoof or self-declare roles |
| **P9-CHK-05** | **Cloudflare / Captcha Detection** | Visiting challenge page triggers `CHALLENGE_REQUIRED` and pauses automation | Pass: `ERR_PROVIDER_CAPTCHA`, no infinite retry |
| **P9-CHK-06** | **Auth Status Heuristics** | Login page redirect updates authStatus to `LOGIN_REQUIRED` | Pass: `ERR_PROVIDER_AUTH_REQUIRED` |
| **P9-CHK-07** | **Rate Limit / Quota Detection** | 429 response or quota text triggers `QUOTA_EXCEEDED` fail-closed | Pass: `ERR_PROVIDER_QUOTA_EXCEEDED` |
| **P9-CHK-08** | **Native Thread Capture** | Visiting active chat thread captures canonical URL and thread ID | Pass: `threadId` extracted, `isReopenable: true` |
| **P9-CHK-09** | **Text Share Provenance** | Sharing text attaches `LIVE_WEB` provenance, source URL, and session ID | Pass: Envelope signed with authoritative provider identity |
| **P9-CHK-10** | **File Share Canonical Guard** | File sharing enforces `assertCanonicalWorkspacePath` and 100MB boundary | Pass: Traversal & junction escapes rejected |
| **P9-CHK-11** | **6-AI Collaborative Task Graph** | DAG coordinates all 6 actors (ChatGPT, Gemini, Claude, Antigravity, DeepSeek, Codex) | Pass: Consensus with locked digests and zero synthetic approval |

---

## 2. Modality Level Guide

- `AUTO_VERIFIED`: Automated parsing and background verification supported with cryptographic evidence.
- `MANUAL_ASSISTED`: User performs action or triggers export within the embedded Chromium tab; Union Bot captures and binds provenance.
- `REFERENCE_ONLY`: External links or native references captured for reference; external app required for full interaction.
