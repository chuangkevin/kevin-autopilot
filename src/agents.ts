import type { AgentHandoffSummary, IdeaRecord } from './types.js'

export function createAgentHandoff(record: Omit<IdeaRecord, 'agentHandoff'> | Omit<IdeaRecord, 'agentHandoff' | 'thinking'>): AgentHandoffSummary {
  const superpowers = selectSuperpowers(record)
  const safetyAnswer = record.approvalRequired
    ? '需要 approval gate；先只產生規格、問題與驗證計畫，不執行 repo/deploy/production 動作。'
    : '可維持 read-only exploration，先收斂痛點、成功條件與可驗證原型。'
  const specAnswer = record.classification === 'explore'
    ? '先補足目標使用者、現有卡點、第一版驗證訊號，再進入 OpenSpec。'
    : '可整理成 OpenSpec proposal/tasks，但所有 mutating action 必須等 Kevin 明確批准。'

  return {
    superpowers,
    agents: [
      {
        from: 'kevin-persona',
        to: 'safety-reviewer',
        question: '這個想法能不能在不破壞既有流程的前提下先做最小驗證？',
        answer: safetyAnswer,
      },
      {
        from: 'safety-reviewer',
        to: 'spec-planner',
        question: '下一步應該產生實作任務，還是先補規格與 approval gate？',
        answer: specAnswer,
      },
      {
        from: 'spec-planner',
        to: 'kevin-persona',
        question: '是否符合 Kevin 的 UX、穩定性、可驗證性排序？',
        answer: '先保留原始意圖，避免過度設計；下一步必須能被測試或人工檢查。',
      },
    ],
    decision: record.approvalRequired ? 'requires-approval-before-action' : 'safe-to-explore-read-only',
  }
}

function selectSuperpowers(record: Omit<IdeaRecord, 'agentHandoff'> | Omit<IdeaRecord, 'agentHandoff' | 'thinking'>): string[] {
  const skills = ['using-superpowers']
  if (record.classification === 'explore') skills.push('brainstorming')
  if (record.classification === 'plan' || record.classification === 'prototype') skills.push('planning')
  if (record.approvalRequired) skills.push('subagent-driven-development')
  return skills
}
