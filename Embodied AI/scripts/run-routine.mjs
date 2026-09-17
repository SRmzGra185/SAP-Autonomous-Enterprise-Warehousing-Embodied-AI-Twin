/** Manual local replay only. See src/routine-library.mjs for export/integration contract.
 * node scripts/run-routine.mjs <project-root>/routine.recipe.json
 * No extra arguments, environment overrides, credentials, URL flags or child processes.
 * No import-time side effects. replayRecipe's dependencies are for in-process tests only.
 */
import { open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRecipe } from '../src/routine-library.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://localhost:4173';
const EXPECTED_APP = 'SAP Autonomous Operations Twin';

async function localJson(fetchImpl, path, options = {}) {
  const response = await fetchImpl(ORIGIN + path, { ...options, redirect: 'error',
    credentials: 'omit', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Local app rejected the request. Open the app; no credentials are accepted by this launcher.');
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16384) throw new Error('Unexpected local app response.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function replayRecipe(input, { fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const recipe = validateRecipe(input);
  const health = await localJson(fetchImpl, '/api/health');
  if (health.ok !== true || health.app !== EXPECTED_APP || health.authMode !== 'desktop')
    throw new Error('Expected the local Operations Twin in desktop auth mode. Open the app instead; do not supply tokens.');
  const payload = { scenarioId: recipe.scenarioId, mode: recipe.mode, cycles: 1, speed: 1, caseContext: recipe.caseContext };
  const job = await localJson(fetchImpl, '/api/robot-routines', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  if (!job || typeof job.jobId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(job.jobId)
    || job.events !== `/api/jobs/${job.jobId}/events`) throw new Error('Unexpected job response. Check the app before retrying; a job may already have been queued.');
  log(`Queued local ${recipe.mode} job ${job.jobId}. No live commands or LLM calls.`);
  log('Open http://localhost:4173 to review progress and approve assisted steps. This launcher never approves steps.');
  return job;
}
export async function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || typeof args[0] !== 'string' || resolve(args[0]) !== resolve(ROOT, 'routine.recipe.json'))
    throw new Error('Copy run-routine.bat and routine.recipe.json to the project root; keep scripts/ and src/. No additional arguments are supported.');
  const file = await open(resolve(ROOT, 'routine.recipe.json'), 'r');
  let contents;
  try {
    if (!(await file.stat()).isFile()) throw new Error('Recipe must be a JSON file.');
    const buffer = Buffer.alloc(16385);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count > 16384) throw new Error('Recipe exceeds the 16 KiB limit.');
    contents = buffer.subarray(0, count).toString('utf8');
  } finally { await file.close(); }
  return replayRecipe(JSON.parse(contents));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Replay stopped. Verify the recipe and local desktop app at http://localhost:4173. Check the app before retrying; a job may already be queued. No tokens, URL overrides or extra arguments are supported.');
    process.exitCode = 1;
  });
}
