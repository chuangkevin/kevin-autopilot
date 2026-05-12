import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { createServer } from 'node:http'
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
    assert.equal(report.projectRadar.length, 1)
    assert.equal(report.projectRadar[0]?.name, 'Example')
    assert.equal(report.projectRadar[0]?.status, 'unknown')
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
    assert.equal(report.projectRadar.length, 2)
    assert.equal(report.projectRadar.find((project) => project.name === 'missing-repo')?.status, 'needs_attention')
    assert.equal(report.projectRadar.find((project) => project.name === 'Broken Service')?.status, 'needs_attention')
    assert.equal(report.projectRadar.every((project) => project.nextObservation.length > 0), true)
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

test('project radar treats healthy service-only projects as healthy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-'))
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('ok')
  })
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object' && 'port' in address)
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir: join(root, 'data'),
      ruleSources: [],
      repositories: [],
      services: [
        {
          name: 'Healthy Service Only',
          source: 'test',
          healthCheck: { enabled: true, url: `http://127.0.0.1:${address.port}/health`, timeoutMs: 1000 },
        },
      ],
    }

    const report = await observe(config)
    assert.equal(report.projectRadar.length, 1)
    assert.equal(report.projectRadar[0]?.name, 'Healthy Service Only')
    assert.equal(report.projectRadar[0]?.status, 'healthy')
    assert.equal(report.projectRadar[0]?.services[0]?.healthStatus, 'ok')
  } finally {
    server.close()
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
    assert.equal(report.mainAgent.recommendation.decision, 'collect-more-evidence')
    assert.equal(report.mainAgent.qualityReview.gaps.some((gap) => gap.gap === '目前只是 suspected 弱訊號'), true)
    assert.match(report.mainAgent.qualityReview.nextReviewFocus, /read-only/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('main agent routes qualified-but-gapped improvements to evidence collection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kevin-autopilot-'))
  try {
    const config: AutopilotConfig = {
      environment: 'test',
      dataDir: join(root, 'data'),
      ruleSources: [],
      repositories: [
        {
          name: 'missing-repo',
          path: join(root, 'missing'),
        },
      ],
      services: [],
    }

    const report = await observe(config)
    assert.equal(report.candidates[0]?.confidence, 'likely')
    assert.equal(report.mainAgent.qualityReview.gaps.some((gap) => gap.gap === '改善候選還沒有證明 why now'), true)
    assert.equal(report.mainAgent.recommendation.decision, 'collect-more-evidence')
    assert.match(report.mainAgent.recommendation.nextAction, /阻塞目前工作流|housekeeping/)
    assert.match(report.mainAgent.activeTask.currentStep, /補證據/)
    assert.equal(report.mainAgent.activeTask.checkpoints.find((checkpoint) => checkpoint.id === 'evidence-gap')?.status, 'in_progress')
    assert.equal(report.mainAgent.activeTask.checkpoints.find((checkpoint) => checkpoint.id === 'handoff')?.status, 'pending')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
