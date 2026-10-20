# ADR-V4-001: Unified Single State Authority & Append-Only Event Journal

## Context
In V3.1, tasks could be dispatched either directly via `TasksInbox.executeTask` or via `TaskGraphService`. Furthermore, envelopes persisted to SQLite were broadcast immediately without an authoritative conversation router or delivery receipts. This created potential race conditions where a task might be started by two concurrent mechanisms, or a message might be considered "sent" when it was only saved locally.

## Decision
1. **Single State Authority**: The `WorkflowSupervisor` backed by the existing `TaskGraph` engine is the sole authority for task execution state transitions (`QUEUED -> LEASED -> RUNNING -> PRODUCED -> REVIEW_PENDING -> VERIFIED`). `TasksInbox` and UI components must read from this unified state and dispatch requests through `WorkflowSupervisor`.
2. **Append-Only Event Journal**: All domain actions emit immutable `ActivityEvent` records to an append-only journal in SQLite WAL. Duplicate events are filtered via `idempotencyKey` and `correlationId`.
3. **Delivery Receipts**: Outgoing messages must create a `DeliveryAttempt` record with state `PERSISTED`. Only when a verified acknowledgement or reply is correlated does the state become `ACKED` or `VERIFIED`.

## Consequences
- Prevents double-execution of tasks.
- Eliminates fake "Sent" messages when offline or unacknowledged.
- Maintains strict zero-cost compliance by preventing accidental duplicate API invocations.
