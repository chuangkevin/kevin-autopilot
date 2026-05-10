import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import { runGit } from './git.js'
import { APP_VERSION } from './version.js'
import type {
  AutopilotConfig,
  ObservationReport,
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
    safety: {
      mode: 'read-only',
      skippedSecretPatterns: SKIPPED_SECRET_PATTERNS,
      mutatingActions: 'disabled',
      deploymentActions: 'disabled',
    },
  }
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
