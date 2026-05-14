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
import { getEffectiveConfig } from './runtime-overrides.js'
import type {
  AutopilotConfig,
  BacklogItem,
  IdeaGraph,
  ObservationLoopState,
  ObservationReport,
  ReflectionStateRecord,
  SkippedReflectionRecord,
} from './types.js'

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000
const MIN_INTERVAL_MS = 60_000

export class ObservationLoop {
  private state: ObservationLoopState
  private timer: ReturnType<typeof setTimeout> | undefined
  private currentIntervalMs: number
  private lastInterestingNodeIds: Set<string> = new Set()
  private lastBacklogSeenCounts: Map<string, number> = new Map()
  private lastReport: ObservationReport | undefined
  private inFlight: Promise<ObservationReport | undefined> | undefined

  constructor(private readonly config: AutopilotConfig) {
    const baseIntervalMs = config.backgroundObservation?.intervalMs ?? DEFAULT_INTERVAL_MS
    this.currentIntervalMs = baseIntervalMs
    this.state = {
      mode: 'read-only-background-observation',
      enabled: config.backgroundObservation?.enabled !== false,
      intervalMs: baseIntervalMs,
      currentIntervalMs: baseIntervalMs,
      baseIntervalMs,
      lastExcitementScore: 0,
      excitementMode: 'normal',
      running: false,
      runCount: 0,
    }
  }

  start(): void {
    if (this.timer) return
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

  async getEffectiveState(): Promise<ObservationLoopState> {
    await this.refreshLoopConfig()
    return this.getState()
  }

  getLastReport(): ObservationReport | undefined {
    return this.lastReport
  }

  async runOnce(): Promise<ObservationReport | undefined> {
    await this.refreshLoopConfig()
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
    const effectiveConfig = await getEffectiveConfig(this.config)
    this.stop()
    this.state = {
      ...this.state,
      enabled: effectiveConfig.backgroundObservation?.enabled !== false,
      intervalMs: effectiveConfig.backgroundObservation?.intervalMs ?? DEFAULT_INTERVAL_MS,
      running: true,
      lastStartedAt: new Date().toISOString(),
      lastError: undefined,
      nextRunAt: undefined,
    }
    await this.persistStateSafely()

    try {
      if (!this.state.enabled) return this.lastReport
      const report = await observe(effectiveConfig)
      const written = await writeReports(report, effectiveConfig.dataDir)
      const backlogAt = await this.mergeBacklogSafely(effectiveConfig, report)
      const ideas = await listIdeas(effectiveConfig, 40)
      const graph = await getIdeaGraph(effectiveConfig, report, ideas)
      const reflectionResult = await this.runReflectionSafely(effectiveConfig, graph)
      const backlogSnapshot = listBacklogSnapshot(effectiveConfig)
      const excitementScore = this.computeExcitementScore(
        graph,
        backlogSnapshot,
        reflectionResult?.newSeedCount ?? 0,
      )
      this.lastInterestingNodeIds = new Set(
        graph.nodes.filter((node) => node.interesting).map((node) => node.id),
      )
      this.lastBacklogSeenCounts = new Map(
        backlogSnapshot.map((item) => [item.id, item.seenCount]),
      )
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
        lastReflectionAt: reflectionResult?.at ?? this.state.lastReflectionAt,
        lastReportPath: written.jsonPath,
        lastMarkdownPath: written.markdownPath,
        lastExcitementScore: excitementScore,
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
      await this.scheduleNextRun()
      await this.persistStateSafely()
    }
  }

  private async scheduleNextRun(): Promise<void> {
    await this.refreshLoopConfig()
    if (!this.state.enabled) return

    const base = this.state.intervalMs
    const score = this.state.lastExcitementScore

    if (score > 0) {
      this.currentIntervalMs = MIN_INTERVAL_MS
    } else {
      this.currentIntervalMs = Math.min(this.currentIntervalMs * 2, base)
    }

    const excitementMode: ObservationLoopState['excitementMode'] =
      this.currentIntervalMs <= MIN_INTERVAL_MS
        ? 'excited'
        : this.currentIntervalMs < base
          ? 'cooling'
          : 'normal'

    const nextRunAt = new Date(Date.now() + this.currentIntervalMs).toISOString()
    this.state = {
      ...this.state,
      nextRunAt,
      currentIntervalMs: this.currentIntervalMs,
      baseIntervalMs: base,
      excitementMode,
    }
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.runOnce()
    }, this.currentIntervalMs)
    this.timer.unref?.()
  }

  private async mergeBacklogSafely(config: AutopilotConfig, report: ObservationReport): Promise<string | undefined> {
    const db = openBacklogDatabase(config)
    try {
      mergeCandidatesIntoBacklog(db, report.candidates, new Date())
      return new Date().toISOString()
    } finally {
      db.close()
    }
  }

  private async runReflectionSafely(config: AutopilotConfig, graph: IdeaGraph): Promise<{ at: string; newSeedCount: number } | undefined> {
    try {
      const previous = await readReflectionState(config)
      const backlog = listBacklogSnapshot(config)
      const recentIdeas = await listIdeas(config, 20)
      const pendingAiIdeaCount = await countPendingAiIdeas(config)
      const dismissedAiIdeaTitles = await listDismissedAiIdeaTitles(config, 20)
      const previousSignature = previous && previous.skipped === false ? previous.graphSignature : undefined

      const record = await reflect({
        config,
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
              config,
              seed,
              { generatedAt: record.generatedAt, model: record.model },
              index,
            )
          } catch (error) {
            console.warn('Failed to create AI idea from reflection seed:', error instanceof Error ? error.message : String(error))
          }
        }
      }

      await writeReflectionState(config, record)
      return { at: record.generatedAt, newSeedCount: record.skipped === false ? record.newIdeaSeeds.length : 0 }
    } catch (error) {
      const skipped: SkippedReflectionRecord = {
        generatedAt: new Date().toISOString(),
        skipped: true,
        reason: 'error',
        detail: error instanceof Error ? error.message : String(error),
        pendingAiIdeaCount: 0,
      }
      try {
        await writeReflectionState(config, skipped)
      } catch {}
      return { at: skipped.generatedAt, newSeedCount: 0 }
    }
  }

  private computeExcitementScore(graph: IdeaGraph, backlog: BacklogItem[], newSeedCount: number): number {
    const newInteresting = graph.nodes.filter(
      (node) => node.interesting && !this.lastInterestingNodeIds.has(node.id),
    ).length
    const spikes = backlog.filter((item) => {
      const prev = this.lastBacklogSeenCounts.get(item.id) ?? 0
      return item.seenCount - prev >= 3
    }).length
    return newSeedCount + newInteresting + spikes
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

  private async refreshLoopConfig(): Promise<void> {
    const effectiveConfig = await getEffectiveConfig(this.config)
    const enabled = effectiveConfig.backgroundObservation?.enabled !== false
    const newBase = effectiveConfig.backgroundObservation?.intervalMs ?? DEFAULT_INTERVAL_MS
    if (newBase !== this.state.intervalMs) {
      this.currentIntervalMs = Math.min(this.currentIntervalMs, newBase)
    }
    if (!enabled) this.stop()
    this.state = {
      ...this.state,
      enabled,
      intervalMs: effectiveConfig.backgroundObservation?.intervalMs ?? DEFAULT_INTERVAL_MS,
      nextRunAt: enabled ? this.state.nextRunAt : undefined,
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
