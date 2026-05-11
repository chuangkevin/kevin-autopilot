import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import { runGit } from './git.js'
import { listSupplements } from './supplements.js'
import { APP_VERSION } from './version.js'
import type {
  AutopilotConfig,
  ObservationReport,
  ObservationCandidate,
  RepositoryObservation,
  RuleSourceObservation,
  ServiceObservation,
  MainAgentBrief,
  UserSupplement,
} from './types.js'

const SKIPPED_SECRET_PATTERNS = ['.env', '.env.*', '*credential*.json', '*service-account*.json']

export async function observe(config: AutopilotConfig): Promise<ObservationReport> {
  const [ruleSources, repositories, services, supplements] = await Promise.all([
    observeRuleSources(config),
    observeRepositories(config),
    observeServices(config),
    listSupplements(config, 8),
  ])
  const candidates = createObservationCandidates(ruleSources, repositories, services)

  return {
    generatedAt: new Date().toISOString(),
    version: APP_VERSION,
    environment: config.environment,
    ruleSources,
    repositories,
    services,
    candidates,
    supplements,
    mainAgent: createMainAgentBrief(candidates, repositories, services, ruleSources, supplements),
    safety: {
      mode: 'read-only',
      skippedSecretPatterns: SKIPPED_SECRET_PATTERNS,
      mutatingActions: 'disabled',
      deploymentActions: 'disabled',
    },
  }
}

function createMainAgentBrief(
  candidates: ObservationCandidate[],
  repositories: RepositoryObservation[],
  services: ServiceObservation[],
  ruleSources: RuleSourceObservation[],
  supplements: UserSupplement[],
): MainAgentBrief {
  const bugCandidates = candidates.filter((candidate) => candidate.category === 'bug_watch' || candidate.category === 'bug_fix_candidate')
  const dirtyRepos = repositories.filter((repo) => repo.dirty)
  const missingRules = ruleSources.filter((source) => !source.exists || source.missingFiles.length > 0)
  const failedServices = services.filter((service) => service.healthStatus === 'failed')
  const topCandidate = selectTopCandidate(candidates)

  const latestSupplement = supplements[0]
  const supplementSummary = latestSupplement ? `Kevin 最新補充：「${latestSupplement.summary}」。` : 'Kevin 這輪沒有新增補充。'
  const summary = topCandidate
    ? `${supplementSummary} 我先處理「${topCandidate.title}」，因為它最符合使用者體驗、穩定與可驗證性的優先序。`
    : `${supplementSummary} 這一輪沒有明顯候選項；保持觀察，不要硬找事情做。`

  return {
    mode: 'kevin-double-deterministic',
    persona: 'Kevin 子人格主 agent',
    superpowers: ['using-superpowers', 'root-cause-debugging', 'brainstorming', 'planning', 'verification-and-evidence'],
    summary,
    activeTask: createActiveTaskState(candidates, supplements, topCandidate),
    rounds: [
      {
        agent: 'Kevin 子人格',
        role: '產品工程腦',
        observation: `這輪看到 ${candidates.length} 個候選項、${bugCandidates.length} 個疑似 bug、${dirtyRepos.length} 個 dirty repo。`,
        argument: '先找會影響使用者、穩定性或後續驗證的事，不把清單當成果。',
        output: topCandidate ? `優先候選：${topCandidate.title}` : '暫不主動開新工作，避免製造假待辦。',
      },
      {
        agent: 'Kevin 補充',
        role: 'Interrupt / requirement merge',
        observation: supplements.length > 0 ? `目前有 ${supplements.length} 則 Autopilot-owned 補充。` : '目前沒有可合併的 Kevin 補充。',
        argument: '中途補充不能只留在聊天紀錄，必須變成下一輪觀察可讀的結構化輸入。',
        output: latestSupplement ? `下一輪推理納入：${latestSupplement.summary}` : '先維持既有觀察，不假裝 Kevin 已經補充需求。',
      },
      {
        agent: '探索者',
        role: 'Superpower explore',
        observation: `規則來源異常 ${missingRules.length} 個，服務 health 失敗 ${failedServices.length} 個。`,
        argument: '先釐清觀察訊號是否可信，再決定是否交給 OpenCode。',
        output: topCandidate ? `最小探索步驟：${topCandidate.suggestedNextStep}` : '下一輪應擴充觀察來源，而不是直接修復。',
      },
      {
        agent: '懷疑者',
        role: 'QA / 風險審查',
        observation: topCandidate ? `候選項風險：${topCandidate.risk}，approvalRequired=${topCandidate.approvalRequired}` : '沒有候選項可審查。',
        argument: '所有觀察候選都還在 read-only 階段；不能讓 prompt 暗示可直接改 target repo。',
        output: topCandidate?.approvalRequired ? '只允許產生 proposal，不能修改。' : '可先做 read-only 釐清，執行修復前仍需明確切換階段。',
      },
      {
        agent: '建造者',
        role: '可行方案整合',
        observation: topCandidate ? `已有 bounded prompt 可複製給 OpenCode：${topCandidate.id}` : '目前只有觀察報告。',
        argument: '下一步必須是可操作 artifact：prompt、驗證步驟、或 approval 問題。',
        output: topCandidate ? '建議複製該候選項 prompt 給 OpenCode 做 read-only 釐清。' : '建議先增加更多安全訊號，例如 CI status 或允許的 health endpoint。',
      },
    ],
    feasibleOptions: makeFeasibleOptions(topCandidate, candidates, supplements),
    recommendation: {
      decision: topCandidate ? 'prepare-read-only-handoff' : 'observe-only',
      reason: topCandidate
        ? '它是目前最小、最安全、最能產生證據的下一步；Kevin 補充只作為排序與脈絡，不會直接放大權限。'
        : '沒有足夠訊號支持主動插手，硬做會變成垃圾自動化。',
      nextAction: topCandidate ? `複製「${topCandidate.title}」的 OpenCode prompt。` : '保留觀察，下一步增加安全觀察來源或補充真實痛點。',
      candidateId: topCandidate?.id,
      approvalRequired: Boolean(topCandidate?.approvalRequired),
    },
  }
}

function createActiveTaskState(
  candidates: ObservationCandidate[],
  supplements: UserSupplement[],
  topCandidate: ObservationCandidate | undefined,
): MainAgentBrief['activeTask'] {
  return {
    objective: '把 read-only observation 轉成 Kevin 可決策的下一步，而不是自動動手。',
    currentStep: topCandidate ? `準備候選項 ${topCandidate.id} 的 read-only handoff` : '等待更強觀察訊號或 Kevin 補充',
    checkpoints: [
      { id: 'collect-signals', content: '收集 rule source、repo、service 的 read-only 訊號', status: 'completed', priority: 'high' },
      { id: 'merge-supplements', content: '合併 Kevin 補充到下一輪推理', status: supplements.length > 0 ? 'completed' : 'pending', priority: 'high' },
      { id: 'rank-candidates', content: '依 UX、穩定、可驗證性排序候選項', status: candidates.length > 0 ? 'completed' : 'pending', priority: 'high' },
      { id: 'handoff', content: '產生 bounded OpenCode prompt 或保持觀察', status: topCandidate ? 'completed' : 'pending', priority: 'medium' },
    ],
    blockers: [],
    updatedAt: new Date().toISOString(),
    supplementCount: supplements.length,
  }
}

function selectTopCandidate(candidates: ObservationCandidate[]): ObservationCandidate | undefined {
  const score = (candidate: ObservationCandidate): number => {
    const categoryScore: Record<ObservationCandidate['category'], number> = {
      bug_fix_candidate: 90,
      bug_watch: 80,
      needs_kevin_decision: 70,
      improvement_candidate: 60,
      prototype_candidate: 50,
      blocked: 0,
    }
    const confidenceScore: Record<ObservationCandidate['confidence'], number> = {
      confirmed: 20,
      likely: 12,
      suspected: 4,
    }
    const riskPenalty = candidate.risk === 'high' ? 25 : candidate.risk === 'medium' ? 12 : 0
    const approvalPenalty = candidate.approvalRequired ? 8 : 0
    return categoryScore[candidate.category] + confidenceScore[candidate.confidence] - riskPenalty - approvalPenalty
  }

  return [...candidates].sort((a, b) => score(b) - score(a))[0]
}

function makeFeasibleOptions(
  topCandidate: ObservationCandidate | undefined,
  candidates: ObservationCandidate[],
  supplements: UserSupplement[],
): MainAgentBrief['feasibleOptions'] {
  if (!topCandidate) {
    return [
      {
        label: '維持觀察',
        why: supplements.length > 0 ? 'Kevin 已補充脈絡，但目前觀察訊號還不足以形成安全 handoff。' : '目前沒有足夠明確的 bug 或改善訊號。',
        firstStep: '下一輪加入 CI status、允許的 health endpoint，或請 Kevin 補充真實卡點。',
        tradeoff: '不會亂動，但主動性較低。',
        approvalRequired: false,
      },
    ]
  }

  return [
    {
      label: '交給 OpenCode 釐清',
      why: '最符合 read-only 邊界，又能取得下一步證據。',
      firstStep: `複製候選項 ${topCandidate.id} 的 bounded prompt。`,
      tradeoff: '需要人工貼到 OpenCode，尚未自動執行。',
      approvalRequired: topCandidate.approvalRequired,
    },
    {
      label: '先累積更多觀察',
      why: supplements.length > 0 ? '可把 Kevin 補充當排序線索，但仍需要 read-only 證據避免誤判。' : '避免單一訊號誤判，特別是 suspected 類型。',
      firstStep: '再跑一次 observe 或新增安全 health/CI 訊號。',
      tradeoff: '比較穩，但推進較慢。',
      approvalRequired: false,
    },
    {
      label: '暫時忽略低價值項',
      why: `目前共有 ${candidates.length} 個候選，應避免被低價值雜訊拖走。`,
      firstStep: '只保留高信心 bug 或會影響穩定性的項目。',
      tradeoff: '可能延後小改善。',
      approvalRequired: false,
    },
  ]
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
    `- Main agent: ${report.mainAgent.persona}`,
    `- Main agent decision: ${report.mainAgent.recommendation.decision}`,
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
    '## Kevin Double Deliberation',
    '',
    `- Summary: ${report.mainAgent.summary}`,
    `- Active task: ${report.mainAgent.activeTask.currentStep}`,
    `- Supplements: ${report.supplements.length}`,
    `- Recommendation: ${report.mainAgent.recommendation.nextAction}`,
    ...report.mainAgent.rounds.map((round) => `- ${round.agent}（${round.role}）: ${round.output}`),
    '',
    '## Kevin Supplements',
    '',
    ...(
      report.supplements.length === 0
        ? ['- No Kevin supplements were stored for this run.']
        : report.supplements.map((supplement) => `- ${supplement.createdAt}: ${supplement.summary}`)
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
