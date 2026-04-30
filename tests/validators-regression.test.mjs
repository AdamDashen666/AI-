import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

execSync("rm -rf .tmp-test && npx tsc lib/validators.ts lib/types.ts --module nodenext --target es2022 --moduleResolution nodenext --esModuleInterop --outDir .tmp-test", { stdio: 'pipe' });
const validators = await import(pathToFileURL(`${process.cwd()}/.tmp-test/lib/validators.js`).href);

const { validatePlanRequest, validateRunTaskRequest, validateReviewRequest } = validators;

const baseConfig = {
  baseURL: 'https://api.example.com',
  apiKey: 'secret',
  model: 'gpt-test',
  timeoutMs: 2500,
  retryCount: 3,
};

test('validatePlanRequest preserves timeoutMs and retryCount', () => {
  const result = validatePlanRequest({ config: baseConfig, requirement: 'ship feature' });
  assert.equal(result.ok, true);
  assert.equal(result.data.config.timeoutMs, 2500);
  assert.equal(result.data.config.retryCount, 3);
});

test('validateRunTaskRequest preserves complete config', () => {
  const result = validateRunTaskRequest({
    config: baseConfig,
    task: { id: 't1', name: 'Task 1', description: 'desc', workerType: 'code', dependencies: [] },
    requirement: 'ship feature',
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.config.timeoutMs, 2500);
  assert.equal(result.data.config.retryCount, 3);
});

test('validateReviewRequest preserves complete config', () => {
  const result = validateReviewRequest({
    config: baseConfig,
    task: { id: 't2', name: 'Task 2', description: 'desc', workerType: 'code', dependencies: [] },
    output: { taskId: 't2', result: 'done', filesSuggested: [], risks: [], notes: '' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.config.timeoutMs, 2500);
  assert.equal(result.data.config.retryCount, 3);
});

test('validateAIConfig enforces timeout/retry constraints via request validators', () => {
  const timeoutResult = validatePlanRequest({ config: { ...baseConfig, timeoutMs: 0 }, requirement: 'x' });
  assert.equal(timeoutResult.ok, false);
  if (!timeoutResult.ok) assert.match(timeoutResult.error, /timeoutMs/);

  const retryResult = validatePlanRequest({ config: { ...baseConfig, retryCount: -1 }, requirement: 'x' });
  assert.equal(retryResult.ok, false);
  if (!retryResult.ok) assert.match(retryResult.error, /retryCount/);
});
