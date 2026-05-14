import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AutopilotConfig } from './types.js'

export type GraphPositions = Record<string, { x: number; y: number }>

const POSITIONS_FILE = 'graph-positions.json'

export async function loadGraphPositions(config: AutopilotConfig): Promise<GraphPositions> {
  try {
    const raw = await readFile(join(config.dataDir, POSITIONS_FILE), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: GraphPositions = {}
    for (const [id, pos] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        pos !== null &&
        typeof pos === 'object' &&
        !Array.isArray(pos) &&
        'x' in pos &&
        'y' in pos &&
        typeof (pos as { x: unknown }).x === 'number' &&
        typeof (pos as { y: unknown }).y === 'number'
      ) {
        result[id] = { x: (pos as { x: number }).x, y: (pos as { y: number }).y }
      }
    }
    return result
  } catch {
    return {}
  }
}

export async function saveGraphPositions(config: AutopilotConfig, positions: GraphPositions): Promise<void> {
  await mkdir(config.dataDir, { recursive: true })
  await writeFile(join(config.dataDir, POSITIONS_FILE), `${JSON.stringify(positions, null, 2)}\n`, 'utf8')
}
