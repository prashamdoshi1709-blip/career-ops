// tests/pipeline-append-recheck.test.mjs — overlapping scans (2026-11-23).
//
// The scheduled recruiter check, the six-hour directory sweep and a manual
// scan can overlap. Each loads the seen set when it starts, so two of them can
// both decide the same new URL is unseen. appendToPipeline re-checks the inbox
// under its lock, so the second writer adds nothing. Exact URLs only: language
// versions a scan keeps apart on purpose must stay apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendToPipeline } from '../scan.mjs';

const offer = (url, title = 'Associate – Private Credit') => ({ url, title, company: 'Example Recruiter', location: 'Sydney, Australia' });
const lines = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l.startsWith('- [ ]'));

test('a URL already in the inbox is not appended again by a second scan', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-recheck-'));
  try {
    const p = join(dir, 'pipeline.md');
    writeFileSync(p, '# Pipeline\n\n## Pending\n\n## Processed\n');
    await appendToPipeline([offer('https://recruiter.example/mandates/a/')], { pipelinePath: p });
    await appendToPipeline([offer('https://recruiter.example/mandates/a'), offer('https://recruiter.example/mandates/b/')], { pipelinePath: p });
    const l = lines(p);
    assert.equal(l.length, 2, l.join('\n'));
    assert.ok(l.some((x) => x.includes('/mandates/b/')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('two scans appending the same new URL at once leave one inbox row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-recheck-'));
  try {
    const p = join(dir, 'pipeline.md');
    writeFileSync(p, '# Pipeline\n\n## Pending\n\n## Processed\n');
    const u = 'https://recruiter.example/mandates/race/';
    await Promise.all([appendToPipeline([offer(u)], { pipelinePath: p }), appendToPipeline([offer(u)], { pipelinePath: p })]);
    assert.equal(lines(p).filter((x) => x.includes('/mandates/race/')).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('language versions with different URLs are both kept', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-recheck-'));
  try {
    const p = join(dir, 'pipeline.md');
    writeFileSync(p, '# Pipeline\n\n## Pending\n\n## Processed\n');
    await appendToPipeline([offer('https://jobs.example/p/1?lang=de')], { pipelinePath: p });
    await appendToPipeline([offer('https://jobs.example/p/1?lang=en')], { pipelinePath: p });
    assert.equal(lines(p).length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
