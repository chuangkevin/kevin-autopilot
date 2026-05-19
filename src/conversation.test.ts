import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { appendConversationMessage, listConversationMessages } from './conversation.js'
import type { AutopilotConfig } from './types.js'

function makeConfig(dataDir: string): AutopilotConfig {
  return { environment: 'test', dataDir, ruleSources: [], repositories: [], services: [] }
}

test('appendConversationMessage writes and returns message with id and createdAt', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'conv-test-'))
  const config = makeConfig(dataDir)
  const msg = await appendConversationMessage(config, { sender: 'ai', content: 'Hello Kevin' })
  assert.ok(msg.id.startsWith('msg-'))
  assert.equal(msg.sender, 'ai')
  assert.equal(msg.content, 'Hello Kevin')
  assert.ok(typeof msg.createdAt === 'string')
  const all = await listConversationMessages(config)
  assert.equal(all.length, 1)
  assert.equal(all[0].content, 'Hello Kevin')
})

test('listConversationMessages filters by since timestamp', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'conv-since-'))
  const config = makeConfig(dataDir)
  await appendConversationMessage(config, { sender: 'ai', content: 'first' })
  await new Promise((r) => setTimeout(r, 5))
  const midpoint = new Date().toISOString()
  await new Promise((r) => setTimeout(r, 5))
  await appendConversationMessage(config, { sender: 'kevin', content: 'second' })
  const after = await listConversationMessages(config, { since: midpoint })
  assert.equal(after.length, 1)
  assert.equal(after[0].content, 'second')
})

test('appendConversationMessage truncates to 200 messages', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'conv-limit-'))
  const config = makeConfig(dataDir)
  for (let i = 0; i < 205; i++) {
    await appendConversationMessage(config, { sender: 'ai', content: `msg ${i}` })
  }
  const all = await listConversationMessages(config)
  assert.equal(all.length, 200)
  assert.equal(all[0].content, 'msg 5')
  assert.equal(all[199].content, 'msg 204')
})
