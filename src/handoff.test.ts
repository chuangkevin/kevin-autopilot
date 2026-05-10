import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProjectHandoffPlan } from './handoff.js'
import type { IdeaRecord } from './types.js'

test('createProjectHandoffPlan creates read-only planning metadata', () => {
  const plan = createProjectHandoffPlan({
    id: 'idea-test',
    createdAt: '2026-05-10T00:00:00.000Z',
    environment: 'test',
    rawText: 'Plan repo architecture spec and tests',
    title: 'Plan repo architecture spec and tests',
    classification: 'plan',
    reasons: ['needs plan'],
    suggestedNextSteps: ['write spec'],
    approvalRequired: true,
    thinking: { mode: 'deterministic-fallback', success: true },
  } satisfies Omit<IdeaRecord, 'agentHandoff' | 'projectHandoff'>)

  assert.equal(plan.mode, 'read-only-project-handoff')
  assert.equal(plan.repoName, 'plan-repo-architecture-spec-and-tests')
  assert.equal(plan.specDraft.changeId, 'handoff-plan-repo-architecture-spec-and-tests')
  assert.ok(plan.approvalGates.some((gate) => gate.includes('部署')))
  assert.match(plan.boundedPrompt, /Do not create repos/)
})

test('createProjectHandoffPlan keeps mutation gates for explore ideas', () => {
  const plan = createProjectHandoffPlan({
    id: 'idea-explore',
    createdAt: '2026-05-10T00:00:00.000Z',
    environment: 'test',
    rawText: '整理每天的靈感',
    title: '整理每天的靈感',
    classification: 'explore',
    reasons: ['needs context'],
    suggestedNextSteps: ['ask questions'],
    approvalRequired: false,
    thinking: { mode: 'deterministic-fallback', success: true },
  } satisfies Omit<IdeaRecord, 'agentHandoff' | 'projectHandoff'>)

  assert.ok(plan.approvalGates.some((gate) => gate.includes('建立或修改 repo')))
  assert.ok(plan.approvalGates.some((gate) => gate.includes('secrets')))
  assert.equal(plan.firstArtifact, 'problem brief + missing questions')
})
