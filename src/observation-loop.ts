import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  countPendingAiIdeas,
  createAiIdeaFromSeed,
  listDismissedAiIdeaTitles,
  listIdeas,
} from './ideas.js'
import { getIdeaGraph } from './idea-graph.js'
import { observe, writeReports } from './observer.js'
import { listBacklog, mergeCandidatesIntoBacklog, openBacklogDatabase } from './backlog.js'
import { reflect } from './reflection.js'
import type {
  AutopilotConfig,
  IdeaGraph,
  ObservationLoopState,
  ObservationReport,
  ReflectionStateRecord,
  SkippedReflectionRecord,
} from './types.js'

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000

export class ObservationLoop {
  private state: ObservationLoopState
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastReport: ObservationReport | undefined
  private inFlight: Promise<ObservationReport | undefined> | undefined

  constructor(private readonly config: AutopilotConfig) {
    this.state = {
      mode: 'read-only-background-observation',
      enabled: config.backgroundObservation?.enabled !== false,
      intervalMs: config.backgroundObservation?.intervalMs ?? DEFAULT_INTERVAL_MS,
      running: false,
      runCount: 0,
    }
  }

  start(): void {
    if (!this.state.enabled || this.timer) return
    void this.runOnce().catch((error) => {
      this.state = {
        ...this.state,
        running: false,
        lastSuccess: false,
        lastFinishedAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message : String(error),
      }
    })
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  getState(): ObservationLoopState {
    return { ...this.state }
  }

  getLastReport(): ObservationReport | undefined {
    return this.lastReport
  }

  async runOnce(): Promise<ObservationReport | undefined> {
    if (!this.state.enabled) return this.lastReport
    if (this.inFlight) return this.inFlight

    this.inFlight = this.executeRun()
    try {
      return await this.inFlight
    } finally {
      this.inFlight = undefined
    }
  }

  private async executeRun(): Promise<ObservationReport | undefined> {
    this.stop()
    this.state = {
      ...this.state,
      running: true,
      lastStartedAt: new Date().toISOString(),
      lastError: undefined,
      nextRunAt: undefined,
    }
    await this.persistStateSafely()

    try {
      const report = await observe(this.config)
      const written = await writeReports(report, this.config.dataDir)
      const backlogAt = await this.mergeBacklogSafely(report)
      const ideas = await listIdeas(this.config, 40)
      const graph = await getIdeaGraph(this.config, report, ideas)
      const reflectionAt = await this.runReflectionSafely(graph)
      this.lastReport = report
      this.state = {
        ...this.state,
        running: false,
        runCount: this.state.runCount + 1,
        lastFinishedAt: new Date().toISOString(),
        lastSuccess: true,
        lastReportAt: report.generatedAt,
        lastGraphAt: new Date().toISOString(),
        lastBacklogAt: backlogAt,
        lastReflectionAt: reflectionAt ?? this.state.lastReflectionAt,
        lastReportPath: written.jsonPath,
        lastMarkdownPath: written.markdownPath,
      }
      return report
    } catch (error) {
      this.state = {
        ...this.state,
        running: false,
        runCount: this.state.runCount + 1,
        lastFinishedAt: new Date().toISOString(),
        lastSuccess: false,
        lastError: error instanceof Error ? error.message : String(error),
      }
      return this.lastReport
    } finally {
      this.scheduleNextRun()
      await this.persistStateSafely()
    }
  }

  private scheduleNextRun(): void {
    if (!this.state.enabled) return
    const nextRunAt = new Date(Date.now() + this.state.intervalMs).toISOString()
    this.state = { ...this.state, nextRunAt }
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.runOnce()
    }, this.state.intervalMs)
    this.timer.unref?.()
  }

  private async mergeBacklogSafely(report: ObservationReport): Promise<string | undefined> {
    const db = openBacklogDatabase(this.config)
    try {
      mergeCandidatesIntoBacklog(db, report.candidates, new Date())
      return new Date().toISOString()
    } finally {
      db.close()
    }
  }

  private async runReflectionSafely(graph: IdeaGraph): Promise<string | undefined> {
    try {
      const previous = await readReflectionState(this.config)
      const backlog = listBacklogSnapshot(this.config)
      const recentIdeas = await listIdeas(this.config, 20)
      const pendingAiIdeaCount = await countPendingAiIdeas(this.config)
      const dismissedAiIdeaTitles = await listDismissedAiIdeaTitles(this.config, 20)
      const previousSignature = previous && previous.skipped === false ? previous.graphSignature : undefined

      const record = await reflect({
        config: this.config,
        graph,
        backlog,
        recentIdeas,
        previousSignature,
        dismissedAiIdeaTitles,
        pendingAiIdeaCount,
      })

      if (record.skipped === false) {
        for (let index = 0; index < record.newIdeaSeeds.length; index += 1) {
          const seed = record.newIdeaSeeds[index]
          try {
            await createAiIdeaFromSeed(
              this.config,
              seed,
              { generatedAt: record.generatedAt, model: record.model },
              index,
            )
          } catch (error) {
            console.warn('Failed to create AI idea from reflection seed:', error instanceof Error ? error.message : String(error))
          }
        }
      }

      await writeReflectionState(this.config, record)
      return record.generatedAt
    } catch (error) {
      const skipped: SkippedReflectionRecord = {
        generatedAt: new Date().toISOString(),
        skipped: true,
        reason: 'error',
        detail: error instanceof Error ? error.message : String(error),
        pendingAiIdeaCount: 0,
      }
      try {
        await writeReflectionState(this.config, skipped)
      } catch {}
      return skipped.generatedAt
    }
  }

  private async persistState(): Promise<void> {
    await mkdir(this.config.dataDir, { recursive: true })
    await writeFile(join(this.config.dataDir, 'observation-loop-state.json'), `${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
  }

  private async persistStateSafely(): Promise<void> {
    try {
      await this.persistState()
    } catch (error) {
      this.state = {
        ...this.state,
        lastSuccess: false,
        lastError: `Failed to persist observation loop state: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
}

export function createObservationLoop(config: AutopilotConfig): ObservationLoop {
  return new ObservationLoop(config)
}

const REFLECTION_STATE_FILE = 'reflection-state.json'

export async function readReflectionState(config: AutopilotConfig): Promise<ReflectionStateRecord | undefined> {
  try {
    const text = await readFile(join(config.dataDir, REFLECTION_STATE_FILE), 'utf8')
    return JSON.parse(text) as ReflectionStateRecord
  } catch {
    return undefined
  }
}

export async function writeReflectionState(config: AutopilotConfig, record: ReflectionStateRecord): Promise<void> {
  await mkdir(config.dataDir, { recursive: true })
  await writeFile(join(config.dataDir, REFLECTION_STATE_FILE), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

function listBacklogSnapshot(config: AutopilotConfig) {
  const db = openBacklogDatabase(config)
  try {
    return listBacklog(db, 'all', new Date())
  } finally {
    db.close()
  }
}
