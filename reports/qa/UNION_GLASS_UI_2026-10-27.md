# Union Glass UI — 2026-10-27

## Work dispatched through Union Bot

Room: `qa-audit`. Brief marker: `UNION_GLASS_UI_27`.

- ChatGPT returned the UX specification: collapsible navigation, wide conversation, contextual inspector, readable glass surfaces, truthful AI status, preserved drafts and scroll behavior.
- Gemini returned the art/motion specification: charcoal navy, opalescent mint glass, Aether crystal mascot, interaction states and reduced motion. Gemini remained on Argon.
- Antigravity's initial repository inspection failed with `ERR_ANTIGRAVITY_PERMISSION_REQUIRED` for a headless command. No permissions were weakened. A second task explicitly requested code in its response without tools; Antigravity returned the Aether component successfully.
- Codex applied and audited that component, separated CSS, added reduced-motion preference updates, pointer reset, animation-end cleanup and aggregate latest-turn status. Codex implemented the shared theme/layout and verified the result using the user's existing direct-edit authorization.

## Implemented

- Glass header/navigation/inspector; solid translucent reading surface without per-message backdrop blur.
- Sidebar collapse/expand; responsive room navigation; inspector drawer below 1200px.
- Compact Aether mascot using CSS perspective, pointer tilt, spring-like click reaction, cute face and truthful idle/working/completed/attention states. A successful member cannot mask another failed member in the same latest turn.
- Local mascot interaction never sends a message or selects a provider. Keyboard activation uses a native button.
- Existing Three.js island remains on-demand; reduced its footprint and wired the global motion toggle to its runtime. It still renders at a throttled 4fps when reduced motion is active, rather than being fully on-demand. Heavy island bundle is only loaded when opened.
- Existing stream batching, drafts, copy, markdown, IME handling and scroll preservation retained.

## Verification

- `pnpm build`: passed. Main JS approximately 191.6kB; optional Three.js island approximately 544.9kB (existing large-chunk warning).
- `pnpm typecheck`: passed.
- `pnpm test:workspace`: 58/58 passed, with new mascot local-interaction/animation cleanup/reduced-motion and collapsible responsive layout assertions. Electron UI harness uses mocked AI transport; it does not prove external provider reliability.
- Native app inspection: room navigation, mascot click, collapsed sidebar, open/close 3D island, group bounce control and inspector rendered successfully.
- `union-glass-ui-2026-10-27.png`: actual rendered Electron UI, **test fixture conversation and mocked transport**.

## Live provider result and outstanding limitation

Initial parallel design dispatch completed for ChatGPT and Gemini in the Union room. Antigravity's no-tool code dispatch also completed in the room.

A later three-member review on the new UI returned Antigravity's response in the group, but ChatGPT and Gemini failed with browser-operation timeout. Inspection showed the exact owned review drafts still in their linked native browser tabs. After verifying the marker and current-task text, Codex submitted each existing draft through its source tab; both providers then returned their reviews there. Those manually completed replies were **not** retroactively marked as completed group deliveries.

ChatGPT highlighted long-stream scroll preservation; Gemini and Antigravity highlighted GPU/compositing under simultaneous animation and streaming. Automated tests cover scroll preservation and burst batching; no measured cross-device GPU benchmark was performed. Intermittent background web submission remains unresolved and must not be described as fixed by this UI redesign. No unknown user draft was deleted, and no blind resend was performed.
