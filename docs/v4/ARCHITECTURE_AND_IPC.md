# UNION BOT V4 — ARCHITECTURE, EXECUTION FLOW & IPC AUDIT (U00-002)

## 1. System Overview & Component Boundaries

```mermaid
flowchart TD
    subgraph UI ["Desktop Renderer (React 18 / Vite / TS)"]
        ChatRoom["ChatRoom Component (/chat & /work modes)"]
        GoalDash["Goal & Discovery Dashboard"]
        TasksInbox["TasksInbox (Reads unified state)"]
        BrowserPanel["BrowserPanel (4 Provider Tabs + System Browser)"]
    end

    subgraph Preload ["Preload IPC Bridge"]
        API["window.unionBotAPI (Strict ContextIsolation + Frame Guard)"]
    end

    subgraph MainBackend ["Electron Main Process (Node 24 / CJS)"]
        Main["main.js (Shell & IPC Dispatcher)"]
        Router["ConversationRouter (Intent, Mention, Delivery Receipts)"]
        Discovery["DiscoveryService (BA / RequirementFact Ledger)"]
        GoalPlan["GoalPlanService (Frozen Briefs, Plan DAG Revisions)"]
        Supervisor["WorkflowSupervisor (Durable Leases, Single Authority)"]
        TaskGraph["TaskGraph Engine (Existing DAG State Machine)"]
        CostGuard["CostGuard ($0.00 Strict Hard Gates)"]
        Storage["StorageService (SQLite WAL + Dedicated Worker)"]
        CAS["ArtifactStore (SHA-256 Content-Addressed Storage)"]
        BrowserCtx["BrowserContextService (Observability + Single Controller Lease)"]
        GitReview["GitHubReviewBroker (Single-use Push Consent + Review Receipts)"]
    end

    ChatRoom --> API
    GoalDash --> API
    TasksInbox --> API
    BrowserPanel --> API
    API --> Main
    Main --> Router
    Main --> Discovery
    Main --> GoalPlan
    Main --> Supervisor
    Supervisor --> TaskGraph
    Router --> CostGuard
    Router --> Storage
    Router --> CAS
    Supervisor --> Storage
    GoalPlan --> Storage
    Discovery --> Storage
```

## 2. Sequence: Message Routing & Delivery Receipt Verification

```mermaid
sequenceDiagram
    autonumber
    actor User as User / PO
    participant UI as ChatRoom UI
    participant IPC as Preload IPC
    participant Router as ConversationRouter
    participant Store as SQLite WAL Storage
    participant Agent as Target Provider (Native / Web / Manual)
    participant Group as ActivityProjection (Group Chat)

    User->>UI: Submit message (e.g. "/chat" or "@ChatGPT BA ...")
    UI->>IPC: dispatchEnvelope(envelope)
    IPC->>Router: routeMessage(envelope)
    Router->>Store: persistEnvelope(state=PERSISTED)
    Note over Router,UI: UI marks "Saved locally" (NOT sent to AI)
    Router->>Agent: deliverWithCorrelation(requestId, watermark)
    alt Automated Provider Responds
        Agent-->>Router: reply(correlationId, responseText, artifacts)
        Router->>Store: recordDeliveryAttempt(state=ACKED)
        Router->>Store: persistResponseEnvelope(state=VERIFIED)
        Router->>Group: emitActivity(summary, deepRefs)
        Router-->>UI: notifyTurnComplete(envelope)
    else Manual Relay Required
        Router->>Store: recordDeliveryAttempt(state=MANUAL_RELAY)
        Router-->>UI: promptManualHandoff(packet)
    end
```

## 3. IPC Channel Inventory & V4 Extension Points

1. `union-bot:dispatch-envelope`: Enhanced with `ConversationRouter` to route intent and record delivery receipts.
2. `union-bot:get-discovery-state`: New IPC for `/chat` BA facts and open questions.
3. `union-bot:update-requirement-fact`: Confirms, supersedes, or rejects facts by PO.
4. `union-bot:approve-plan-revision`: Binds plan hash, discovery digest, and single-use PO approval.
5. `union-bot:supervisor-action`: Controls pause, resume, cancel, and reconciliation.
6. `union-bot:github-request-push`: Requests single-use PO consent for review branch push.
7. `union-bot:github-receive-review`: Records incoming review verdict from ChatGPT Web.
8. `union-bot:browser-acquire-controller`: Grants single controller lease to an agent.
