import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAgentHandoff } from './agents.js'
import type { IdeaRecord } from './types.js'

test('createAgentHandoff records superpowers and agent questions', () => {
  const handoff = createAgentHandoff({
    id: 'idea-test',
    createdAt: '2026-05-10T00:00:00.000Z',
    environment: 'test',
    rawText: 'Plan a repo',
    title: 'Plan a repo',
    classification: 'plan',
    reasons: ['needs plan'],
    suggestedNextSteps: ['write spec'],
    approvalRequired: true,
    thinking: { mode: 'deterministic-fallback', success: true },
  } satisfies Omit<IdeaRecord, 'agentHandoff'>)

  assert.deepEqual(handoff.superpowers, ['using-superpowers', 'planning', 'subagent-driven-development'])
  assert.equal(handoff.agents.length, 3)
  assert.equal(handoff.decision, 'requires-approval-before-action')
})
