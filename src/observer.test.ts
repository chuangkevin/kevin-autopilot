import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { observe, writeReports } from './observer.js'
import { createSupplement } from './supplements.js'
import type { AutopilotConfig } from './types.js'

test('observe records rule source provenance and disabled service checks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-'))
  try {
    const rules = join(root, 'rules')
    const data = join(root, 'data')
    await mkdir(rules)
    await writeFile(join(rules, 'AGENTS.md'), '# Rules\n', 'utf8')

    const config: AutopilotConfig = {
      environment: 'test',
      dataDir: data,
      ruleSources: [
        {
          name: 'homelab-docs',
          path: rules,
          required: true,
          entryFiles: ['AGENTS.md', '.env'],
        },
      ],
      repositories: [],
      services: [
        {
          name: 'Example',
          source: 'test',
          healthCheck: { enabled: false },
        },
      ],
    }

    const report = await observe(config)
    assert.equal(report.ruleSources[0]?.loadedFiles.length, 1)
    assert.deepEqual(report.ruleSources[0]?.missingFiles, ['.env'])
    assert.equal(report.services[0]?.healthStatus, 'disabled')
    assert.equal(report.candidates.some((candidate) => candidate.category === 'improvement_candidate'), true)
    assert.match(report.candidates[0]?.boundedPrompt ?? '', /Constraints:/)
    assert.equal(report.supplements.length, 0)
    assert.equal(report.mainAgent.activeTask.supplementCount, 0)
    assert.equal(report.mainAgent.rounds.some((round) => round.agent === 'Kevin 補充'), true)
    assert.ok(['qualified', 'needs_more_context', 'not_qualified'].includes(report.mainAgent.qualityReview.verdict))
    assert.equal(report.mainAgent.qualityReview.checks.some((check) => check.label === '安全邊界與 approval gate'), true)

    const written = await writeReports(report, data)
    const markdown = await readFile(written.markdownPath, 'utf8')
    assert.match(markdown, /Kevin Autopilot Observation Report/)
    assert.match(markdown, /Observation Backlog/)
    assert.match(markdown, /Kevin Double Deliberation/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('observe creates backlog candidates from repo and service signals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-'))
  try {
    const data = join(root, 'data')
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir: data,
      ruleSources: [],
      repositories: [
        {
          name: 'missing-repo',
          path: join(root, 'missing'),
        },
      ],
      services: [
        {
          name: 'Broken Service',
          source: 'test',
          healthCheck: { enabled: true, url: 'http://127.0.0.1:1/health', timeoutMs: 50 },
        },
      ],
    }

    await createSupplement(config, '先不要碰部署，下一輪優先看 dashboard 使用流程。')
    const report = await observe(config)
    assert.equal(report.candidates.some((candidate) => candidate.category === 'improvement_candidate' && candidate.sourceName === 'missing-repo'), true)
    assert.equal(report.candidates.some((candidate) => candidate.category === 'bug_watch' && candidate.sourceName === 'Broken Service'), true)
    assert.equal(report.candidates.every((candidate) => candidate.boundedPrompt.includes('Required output:')), true)
    assert.equal(report.supplements.length, 1)
    assert.match(report.mainAgent.summary, /先不要碰部署/)
    assert.equal(report.mainAgent.activeTask.supplementCount, 1)
    assert.equal(report.mainAgent.qualityReview.score >= 50, true)
    assert.equal(report.mainAgent.qualityReview.checks.some((check) => check.status === 'pass'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('main agent quality review does not qualify weak suspected signals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir: join(root, 'data'),
      ruleSources: [],
      repositories: [],
      services: [
        {
          name: 'Service Without Health Policy',
          source: 'test',
        },
      ],
    }

    const report = await observe(config)
    assert.equal(report.candidates[0]?.confidence, 'suspected')
    assert.equal(report.mainAgent.qualityReview.verdict, 'needs_more_context')
    assert.ok(report.mainAgent.qualityReview.score < 90)
    assert.equal(report.mainAgent.qualityReview.checks.some((check) => check.status === 'warn'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
