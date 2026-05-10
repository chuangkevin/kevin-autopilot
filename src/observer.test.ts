import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { observe, writeReports } from './observer.js'
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

    const written = await writeReports(report, data)
    const markdown = await readFile(written.markdownPath, 'utf8')
    assert.match(markdown, /Kevin Autopilot Observation Report/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
