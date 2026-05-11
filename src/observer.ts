import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import { runGit } from './git.js'
import { APP_VERSION } from './version.js'
import type {
  AutopilotConfig,
  ObservationReport,
  ObservationCandidate,
  RepositoryObservation,
  RuleSourceObservation,
  ServiceObservation,
} from './types.js'

const SKIPPED_SECRET_PATTERNS = ['.env', '.env.*', '*credential*.json', '*service-account*.json']

export async function observe(config: AutopilotConfig): Promise<ObservationReport> {
  const [ruleSources, repositories, services] = await Promise.all([
    observeRuleSources(config),
    observeRepositories(config),
    observeServices(config),
  ])

  return {
    generatedAt: new Date().toISOString(),
    version: APP_VERSION,
    environment: config.environment,
    ruleSources,
    repositories,
    services,
    candidates: createObservationCandidates(ruleSources, repositories, services),
    safety: {
      mode: 'read-only',
      skippedSecretPatterns: SKIPPED_SECRET_PATTERNS,
      mutatingActions: 'disabled',
      deploymentActions: 'disabled',
    },
  }
}

function createObservationCandidates(
  ruleSources: RuleSourceObservation[],
  repositories: RepositoryObservation[],
  services: ServiceObservation[],
): ObservationCandidate[] {
  const candidates: Array<Omit<ObservationCandidate, 'boundedPrompt'>> = []

  for (const source of ruleSources) {
    if (!source.exists) {
      candidates.push({
        id: candidateId('rule_source', source.name, 'missing-source'),
        category: source.required ? 'needs_kevin_decision' : 'improvement_candidate',
        confidence: 'likely',
        title: `${source.name} rule source is missing`,
        sourceType: 'rule_source',
        sourceName: source.name,
        evidence: [`Configured path does not exist: ${source.path}`],
        expectedBehavior: 'Required rule sources should be available before Autopilot makes work decisions.',
        actualBehavior: 'The configured rule source path could not be found.',
        suggestedNextStep: 'Confirm the mount/path for this environment before relying on decisions from this run.',
        approvalRequired: source.required,
        risk: source.required ? 'high' : 'medium',
      })
      continue
    }

    if (source.missingFiles.length > 0) {
      candidates.push({
        id: candidateId('rule_source', source.name, 'missing-files'),
        category: 'improvement_candidate',
        confidence: 'likely',
        title: `${source.name} has missing rule files`,
        sourceType: 'rule_source',
        sourceName: source.name,
        evidence: [`Missing files: ${source.missingFiles.join(', ')}`],
        expectedBehavior: 'Configured rule entry files should be loadable so early constraints are not forgotten.',
        actualBehavior: 'One or more configured rule entry files could not be loaded or were skipped as secret-like paths.',
        suggestedNextStep: 'Update config entry files or restore the missing non-secret rule files.',
        approvalRequired: false,
        risk: 'low',
      })
    }
  }

  for (const repo of repositories) {
    if (!repo.exists) {
      candidates.push({
        id: candidateId('repository', repo.name, 'missing-repo'),
        category: 'improvement_candidate',
        confidence: 'likely',
        title: `${repo.name} repository path is missing`,
        sourceType: 'repository',
        sourceName: repo.name,
        evidence: [`Configured path does not exist: ${repo.path}`],
        expectedBehavior: 'Configured repositories should be mounted/readable for continuous observation.',
        actualBehavior: 'Autopilot could not find the configured repository path.',
        suggestedNextStep: 'Fix the repository mount/path or remove it from observation config.',
        approvalRequired: false,
        risk: 'low',
      })
      continue
    }

    if (repo.error) {
      candidates.push({
        id: candidateId('repository', repo.name, 'git-error'),
        category: 'bug_watch',
        confidence: 'suspected',
        title: `${repo.name} git observation failed`,
        sourceType: 'repository',
        sourceName: repo.name,
        evidence: [repo.error],
        expectedBehavior: 'Autopilot should read safe git metadata from configured repositories.',
        actualBehavior: 'Git metadata collection failed for this repository.',
        suggestedNextStep: 'Run the smallest git status check in that repo and inspect path/permission issues.',
        approvalRequired: false,
        risk: 'low',
      })
    } else if (repo.dirty) {
      candidates.push({
        id: candidateId('repository', repo.name, 'dirty-worktree'),
        category: 'improvement_candidate',
        confidence: 'suspected',
        title: `${repo.name} has uncommitted work`,
        sourceType: 'repository',
        sourceName: repo.name,
        evidence: [`Branch: ${repo.branch ?? 'unknown'}`, 'git status --short returned changes'],
        expectedBehavior: 'Active work should be converged, documented, committed, and pushed when safe.',
        actualBehavior: 'The repository has uncommitted or untracked changes.',
        suggestedNextStep: 'Review whether the dirty work is active, stale, or ready for verification/commit.',
        approvalRequired: false,
        risk: 'low',
      })
    }
  }

  for (const service of services) {
    if (service.healthStatus === 'failed') {
      candidates.push({
        id: candidateId('service', service.name, 'health-failed'),
        category: 'bug_watch',
        confidence: 'likely',
        title: `${service.name} health check failed`,
        sourceType: 'service',
        sourceName: service.name,
        evidence: [service.healthDetail ?? 'Health check failed without detail'],
        expectedBehavior: 'Explicitly enabled health checks should return a healthy response.',
        actualBehavior: `Health status is failed for ${service.domain ?? service.name}.`,
        suggestedNextStep: 'Verify the endpoint from the target network and inspect the owning repo/service logs if approved.',
        approvalRequired: true,
        risk: 'medium',
      })
    } else if (service.healthStatus === 'not_configured') {
      candidates.push({
        id: candidateId('service', service.name, 'health-not-configured'),
        category: 'improvement_candidate',
        confidence: 'suspected',
        title: `${service.name} has no health policy`,
        sourceType: 'service',
        sourceName: service.name,
        evidence: ['No healthCheck config was provided'],
        expectedBehavior: 'Important services should have an explicit health observation policy.',
        actualBehavior: 'Autopilot cannot tell whether this service should be checked or intentionally skipped.',
        suggestedNextStep: 'Decide whether to disable health checks explicitly or add an approved read-only health endpoint.',
        approvalRequired: false,
        risk: 'low',
      })
    }
  }

  return candidates.map(withBoundedPrompt)
}

function withBoundedPrompt(candidate: Omit<ObservationCandidate, 'boundedPrompt'>): ObservationCandidate {
  return {
    ...candidate,
    boundedPrompt: createBoundedPrompt(candidate),
  }
}

function createBoundedPrompt(candidate: Omit<ObservationCandidate, 'boundedPrompt'>): string {
  const approvalLine = candidate.approvalRequired
    ? '這個候選項需要 Kevin 決策；請先做 read-only 釐清與 proposal，不要直接修改。'
    : '這個候選項目前不需要 Kevin 先決策；可先做 read-only 釐清與 proposal，但不得改檔、commit 或 push，除非 Kevin 另外批准。'

  return [
    '請先讀取 homelab-docs/AGENTS.md，並載入 homelab-docs/kevin-ai-persona/PERSONA.md。',
    '',
    `Observation candidate: ${candidate.title}`,
    `Category: ${candidate.category}`,
    `Confidence: ${candidate.confidence}`,
    `Risk: ${candidate.risk}`,
    `Source: ${candidate.sourceType} / ${candidate.sourceName}`,
    '',
    'Evidence:',
    ...candidate.evidence.map((item) => `- ${item}`),
    '',
    `Expected behavior: ${candidate.expectedBehavior}`,
    `Actual behavior: ${candidate.actualBehavior}`,
    `Suggested next step: ${candidate.suggestedNextStep}`,
    '',
    'Constraints:',
    '- 不得讀取或輸出 secrets、.env、credential、service-account。',
    '- 不得部署、刪資料、重建資料、force push、hard reset。',
    '- 不得修改 target repo、commit 或 push，除非 Kevin 另行批准這個候選項進入執行階段。',
    '- 不得改 user flow、API contract、成本或既有使用者習慣，除非 Kevin 明確批准。',
    '- 先用最小證據確認，不要猜。',
    `- ${approvalLine}`,
    '',
    'Required output:',
    '- 結論',
    '- 證據',
    '- 風險',
    '- 建議下一步',
    '- 哪些沒有做',
  ].join('\n')
}

function candidateId(sourceType: string, sourceName: string, reason: string): string {
  return `${sourceType}-${sourceName}-${reason}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export async function writeReports(report: ObservationReport, dataDir: string): Promise<{ jsonPath: string; markdownPath: string }> {
  await mkdir(dataDir, { recursive: true })
  const safeTimestamp = report.generatedAt.replaceAll(':', '-').replaceAll('.', '-')
  const jsonPath = join(dataDir, `observation-${safeTimestamp}.json`)
  const markdownPath = join(dataDir, `observation-${safeTimestamp}.md`)

  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(markdownPath, renderMarkdown(report), 'utf8')

  return { jsonPath, markdownPath }
}

async function observeRuleSources(config: AutopilotConfig): Promise<RuleSourceObservation[]> {
  return Promise.all(
    config.ruleSources.map(async (source) => {
      const exists = await pathExists(source.path)
      const loadedFiles = []
      const missingFiles = []

      if (exists) {
        for (const entryFile of source.entryFiles) {
          const filePath = join(source.path, entryFile)
          if (isSecretLikePath(filePath)) {
            missingFiles.push(entryFile)
            continue
          }

          try {
            const content = await readFile(filePath, 'utf8')
            loadedFiles.push({ relativePath: entryFile, bytes: Buffer.byteLength(content, 'utf8') })
          } catch {
            missingFiles.push(entryFile)
          }
        }
      }

      return {
        name: source.name,
        path: source.path,
        required: source.required,
        exists,
        loadedFiles,
        missingFiles,
      }
    }),
  )
}

async function observeRepositories(config: AutopilotConfig): Promise<RepositoryObservation[]> {
  return Promise.all(
    config.repositories.map(async (repo) => {
      const exists = await pathExists(repo.path)
      if (!exists) {
        return { name: repo.name, path: repo.path, exists, recentCommits: [] }
      }

      try {
        const [branch, status, commits] = await Promise.all([
          runGit(['branch', '--show-current'], repo.path),
          runGit(['status', '--short'], repo.path),
          runGit(['log', '-5', '--pretty=format:%h %s'], repo.path),
        ])

        return {
          name: repo.name,
          path: repo.path,
          exists,
          branch: branch || '(detached)',
          dirty: status.length > 0,
          recentCommits: commits ? commits.split('\n') : [],
        }
      } catch (error) {
        return {
          name: repo.name,
          path: repo.path,
          exists,
          recentCommits: [],
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),
  )
}

async function observeServices(config: AutopilotConfig): Promise<ServiceObservation[]> {
  return Promise.all(
    config.services.map(async (service) => {
      if (!service.healthCheck) {
        return { ...service, healthStatus: 'not_configured' }
      }

      if (!service.healthCheck.enabled) {
        return { ...service, healthStatus: 'disabled' }
      }

      if (!service.healthCheck.url) {
        return { ...service, healthStatus: 'failed', healthDetail: 'healthCheck.url is required when enabled' }
      }

      const timeoutMs = service.healthCheck.timeoutMs ?? 3000
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await fetch(service.healthCheck.url, { signal: controller.signal })
        return {
          ...service,
          healthStatus: response.ok ? 'ok' : 'failed',
          healthDetail: `${response.status} ${response.statusText}`,
        }
      } catch (error) {
        return {
          ...service,
          healthStatus: 'failed',
          healthDetail: error instanceof Error ? error.message : String(error),
        }
      } finally {
        clearTimeout(timeout)
      }
    }),
  )
}

function renderMarkdown(report: ObservationReport): string {
  const lines = [
    '# Kevin Autopilot Observation Report',
    '',
    `- Environment: ${report.environment}`,
    `- Version: ${report.version}`,
    `- Generated at: ${report.generatedAt}`,
    `- Mode: ${report.safety.mode}`,
    `- Mutating actions: ${report.safety.mutatingActions}`,
    `- Deployment actions: ${report.safety.deploymentActions}`,
    '',
    '## Rule Sources',
    '',
    ...report.ruleSources.map(
      (source) =>
        `- ${source.name}: exists=${source.exists}, loaded=${source.loadedFiles.length}, missing=${source.missingFiles.length}`,
    ),
    '',
    '## Repositories',
    '',
    ...report.repositories.map(
      (repo) =>
        `- ${repo.name}: exists=${repo.exists}, branch=${repo.branch ?? 'unknown'}, dirty=${repo.dirty ?? 'unknown'}, commits=${repo.recentCommits.length}`,
    ),
    '',
    '## Services',
    '',
    ...report.services.map(
      (service) =>
        `- ${service.name}: host=${service.host ?? 'unknown'}, domain=${service.domain ?? 'unknown'}, port=${service.port ?? 'unknown'}, health=${service.healthStatus}`,
    ),
    '',
    '## Observation Backlog',
    '',
    ...(
      report.candidates.length === 0
        ? ['- No candidates generated from the current read-only signals.']
        : report.candidates.map(
            (candidate) =>
              `- ${candidate.category} / ${candidate.confidence}: ${candidate.title} (${candidate.sourceName})\n  - Next: ${candidate.suggestedNextStep}`,
          )
    ),
    '',
    '## Not Done',
    '',
    '- No files outside Autopilot data reports were modified by the observer.',
    '- No deployment, commit, push, repair, or destructive action was attempted.',
    '- Secret-like files and environment values were intentionally not inspected.',
    '',
  ]

  return lines.join('\n')
}

function isSecretLikePath(filePath: string): boolean {
  const name = basename(filePath).toLowerCase()
  return name === '.env' || name.startsWith('.env.') || name.includes('credential') || name.includes('service-account')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}
