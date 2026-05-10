import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIdeaAnalysis } from './ai.js'

test('parseIdeaAnalysis accepts fenced JSON', () => {
  const result = parseIdeaAnalysis(`Here is the result:\n\n\`\`\`json\n{"title":"Idea","classification":"plan","reasons":["ready"],"suggestedNextSteps":["write spec"],"approvalRequired":true}\n\`\`\``)
  assert.equal(result.title, 'Idea')
  assert.equal(result.classification, 'plan')
  assert.deepEqual(result.reasons, ['ready'])
  assert.equal(result.approvalRequired, true)
})

test('parseIdeaAnalysis rejects invalid classification', () => {
  assert.throws(
    () => parseIdeaAnalysis('{"title":"Idea","classification":"ship","reasons":[],"suggestedNextSteps":[],"approvalRequired":false}'),
    /invalid idea classification/,
  )
})
