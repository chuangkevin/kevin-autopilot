import type { IdeaRecord, ProjectHandoffPlan } from './types.js'

type HandoffInput = Omit<IdeaRecord, 'agentHandoff' | 'projectHandoff'>

const MUTATION_GATES = [
  '建立或修改 repo 前需要 Kevin 明確批准',
  '部署、Caddy、DNS、CI/CD 或 production 動作需要 Kevin 明確批准',
  '讀取 secrets、.env、credential 或 service-account 前需要 Kevin 明確批准且必須走安全流程',
  '任何資料刪除、重建或 destructive action 需要 Kevin 明確批准',
]

export function createProjectHandoffPlan(record: HandoffInput): ProjectHandoffPlan {
  const repoName = makeRepoName(record.title || record.rawText)
  const projectName = titleCase(repoName)
  const recommendedState = record.classification === 'blocked' ? 'blocked' : record.classification

  return {
    mode: 'read-only-project-handoff',
    projectName,
    repoName,
    objective: makeObjective(record),
    recommendedState,
    firstArtifact: selectFirstArtifact(record),
    openQuestions: makeOpenQuestions(record),
    approvalGates: makeApprovalGates(record),
    architectureNotes: makeArchitectureNotes(record),
    specDraft: {
      changeId: `handoff-${repoName}`,
      requirements: makeRequirements(record),
      nonGoals: [
        '不在 handoff 階段建立 repo 或修改其他專案',
        '不在 handoff 階段部署、改 Caddy、改 DNS 或觸碰 production',
        '不讀取 unmanaged secrets 或 target repo secret files',
      ],
    },
    implementationTasks: makeImplementationTasks(record),
    verificationChecklist: makeVerificationChecklist(record),
    boundedPrompt: makeBoundedPrompt(record, repoName),
  }
}

function makeObjective(record: HandoffInput): string {
  if (record.classification === 'explore') return '先釐清使用者痛點、成功條件與最小可驗證 artifact。'
  if (record.classification === 'blocked') return '先拆出安全 planning scope，排除 production、secret、資料刪除或部署風險。'
  return `把「${record.title}」整理成可審核的 OpenSpec、架構與驗證計畫。`
}

function selectFirstArtifact(record: HandoffInput): string {
  if (record.classification === 'explore') return 'problem brief + missing questions'
  if (record.classification === 'prototype') return 'small runnable prototype plan'
  if (record.classification === 'blocked') return 'risk review + approval checklist'
  return 'OpenSpec proposal + tasks checklist'
}

function makeOpenQuestions(record: HandoffInput): string[] {
  const questions = [
    '誰是第一個實際使用者？',
    '現在重複痛點或卡住的工作流是什麼？',
    '第一版要用什麼證據判斷有用？',
  ]
  if (record.classification !== 'explore') questions.push('預期 repo 名稱、部署 host、domain 是否已決定？')
  if (record.approvalRequired) questions.push('哪些步驟需要 Kevin 明確 approval gate 才能執行？')
  return questions
}

function makeApprovalGates(record: HandoffInput): string[] {
  if (record.approvalRequired) return MUTATION_GATES
  return ['從 read-only exploration 進入 implementation 前需要 Kevin 確認 scope', ...MUTATION_GATES]
}

function makeArchitectureNotes(record: HandoffInput): string[] {
  return [
    '先保留原始想法文字，避免在規格化時丟失使用者意圖',
    '資料與設定必須只寫 Autopilot-owned storage，不能修改 target repos',
    '設計應先產生可 review 的 plan/spec，再進入任何 mutating action',
    record.classification === 'prototype' ? '原型應以最小可跑流程驗證核心風險' : '先把問題拆成可驗證需求與非目標',
  ]
}

function makeRequirements(record: HandoffInput): string[] {
  return [
    `保留 raw idea 並產生「${record.title}」的 handoff plan`,
    '列出使用者痛點、成功條件、approval gates 與驗證方法',
    '所有後續實作提示必須 bounded、可 review，且不得自動執行 destructive action',
  ]
}

function makeImplementationTasks(record: HandoffInput): string[] {
  if (record.classification === 'explore') {
    return ['補齊 problem brief', '回答 open questions', '決定是否升級成 OpenSpec proposal']
  }
  if (record.classification === 'blocked') {
    return ['隔離 risky request', '建立 approval checklist', '只保留安全 planning 子任務']
  }
  return ['撰寫 OpenSpec proposal', '撰寫 tasks.md', '定義最小資料模型/API/UI', '列出 build/test/smoke 驗證步驟']
}

function makeVerificationChecklist(record: HandoffInput): string[] {
  const checklist = ['文件與 spec 對齊', 'build/test 通過', 'reviewer gate 無 findings']
  if (record.classification !== 'explore') checklist.push('每個 approval gate 都有明確 owner 與觸發條件')
  return checklist
}

function makeBoundedPrompt(record: HandoffInput, repoName: string): string {
  return [
    `Work on the idea titled "${record.title}" as a read-only planning task.`,
    `Candidate repo name: ${repoName}.`,
    'Produce proposal, tasks, architecture notes, and verification checklist only.',
    'Do not create repos, deploy, edit target repos, read secrets, commit/push other projects, or run destructive commands.',
  ].join(' ')
}

function makeRepoName(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return ascii.slice(0, 48) || 'new-homeproject-idea'
}

function titleCase(value: string): string {
  return value.split('-').filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join(' ')
}
