import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AutopilotConfig, ConversationMessage } from './types.js'

const CONVERSATION_FILE = 'conversation.json'
const MAX_MESSAGES = 200

function conversationPath(config: AutopilotConfig): string {
  return join(config.dataDir, CONVERSATION_FILE)
}

function makeId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

async function readAll(config: AutopilotConfig): Promise<ConversationMessage[]> {
  try {
    const raw = await readFile(conversationPath(config), 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as ConversationMessage[]
    return []
  } catch {
    return []
  }
}

export async function appendConversationMessage(
  config: AutopilotConfig,
  msg: Omit<ConversationMessage, 'id' | 'createdAt'>,
): Promise<ConversationMessage> {
  const message: ConversationMessage = {
    id: makeId(),
    sender: msg.sender,
    content: msg.content,
    createdAt: new Date().toISOString(),
  }
  const existing = await readAll(config)
  const updated = [...existing, message].slice(-MAX_MESSAGES)
  await mkdir(config.dataDir, { recursive: true })
  await writeFile(conversationPath(config), `${JSON.stringify(updated, null, 2)}\n`, 'utf8')
  return message
}

export async function listConversationMessages(
  config: AutopilotConfig,
  opts: { since?: string; limit?: number } = {},
): Promise<ConversationMessage[]> {
  const all = await readAll(config)
  const filtered = opts.since ? all.filter((m) => m.createdAt > opts.since!) : all
  const limit = opts.limit ?? MAX_MESSAGES
  return filtered.slice(-limit)
}
