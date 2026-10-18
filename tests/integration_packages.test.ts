import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  CostGuard,
} from '../packages/cost-guard/src/index.ts';
import {
  ArtifactStore,
} from '../packages/artifact-store/src/index.ts';
import {
  createEnvelope,
  EnvelopeSchema,
  MessagePartSchema,
} from '../packages/protocol/src/index.ts';
import {
  Orchestrator,
  AdmissionPolicyGate,
} from '../packages/orchestrator/src/index.ts';

describe('Cross-Package Integration: Protocol, CostGuard, ArtifactStore, Orchestrator', () => {
  it('wires all workspace packages end-to-end under Zero-Cost policy', async () => {
    // 1. Setup isolated CAS artifact store
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'union-integration-test-'));
    const store = new ArtifactStore(tempDir);
    const guard = new CostGuard();
    const gate = new AdmissionPolicyGate({ costGuard: guard });
    const orch = new Orchestrator({ costGuard: guard, artifactStore: store });

    // 2. Cost Guard verification
    assert.equal(guard.isUrlAllowed('https://chatgpt.com'), true);
    assert.equal(guard.isUrlAllowed('https://api.openai.com/v1/chat/completions'), false);

    // 3. Store a binary artifact in CAS
    const dummyImageBuffer = Buffer.from('RAW_PNG_BINARY_CONTENT_FIXTURE_ZERO_COST');
    const meta = store.storeBytes(
      dummyImageBuffer,
      'image/png',
      'original_bytes',
      {
        sourceActor: 'antigravity',
        provider: 'local',
        captureMethod: 'filesystem',
        timestamp: new Date().toISOString(),
      },
      'architecture_diagram.png'
    );
    const storedSha = meta.sha256;
    assert.equal(storedSha.length, 64);
    assert.equal(store.hasArtifact(storedSha), true);

    // 4. Evaluate admission action for dispatching prompt and artifact reference
    const admissionDecision = gate.evaluate({
      actionId: 'act_dispatch_diagram_001',
      actionType: 'SEND_PROMPT',
      provider: 'chatgpt',
      estimatedCost: 0,
      requestedBy: 'antigravity_core',
      targetUrl: 'https://chatgpt.com',
    });
    assert.equal(admissionDecision.allowed, true);
    assert.equal(admissionDecision.policyCode, 'ALLOW_ZERO_COST');

    // 5. Construct envelope with text and artifact part
    const envelope = createEnvelope({
      sender: {
        kind: 'agent',
        id: 'agent_antigravity',
        name: 'Antigravity',
        role: 'IMPLEMENTER',
        provider: 'antigravity',
      },
      recipient: {
        kind: 'room',
        id: 'room_general',
      },
      roomId: 'room_general',
      fidelity: 'L2_STANDALONE_ARTIFACT',
      parts: [
        {
          kind: 'text',
          text: 'Here is the P1 architecture diagram stored in CAS:',
        },
        {
          kind: 'artifact',
          sha256: storedSha,
          mimeType: 'image/png',
          filename: 'architecture_diagram.png',
          sizeBytes: dummyImageBuffer.byteLength,
        },
      ],
    });

    // 6. Dispatch envelope into Orchestrator room
    const dispatchResult = await orch.dispatchEnvelope(envelope);
    assert.equal(dispatchResult.success, true);
    assert.equal(dispatchResult.roomId, 'room_general');

    // 7. Verify history contains the exact envelope and artifact SHA
    const history = orch.getRoomHistory('room_general');
    assert.equal(history.length, 1);
    const retrievedEnvelope = history[0];
    assert.equal(retrievedEnvelope.parts[1].kind, 'artifact');
    if (retrievedEnvelope.parts[1].kind === 'artifact') {
      assert.equal(retrievedEnvelope.parts[1].sha256, storedSha);
      // Retrieve bytes from store to prove roundtrip
      const retrievedBytes = await store.readBytes(retrievedEnvelope.parts[1].sha256);
      assert.deepEqual(retrievedBytes, dummyImageBuffer);
    }

    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
