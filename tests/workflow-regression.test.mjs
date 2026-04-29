import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

execSync('rm -rf .tmp-test && npx tsc lib/workflow.ts lib/types.ts lib/aiClient.ts lib/prompts.ts --module nodenext --target es2022 --moduleResolution nodenext --esModuleInterop --outDir .tmp-test', { stdio: 'pipe' });
const workflow = await import(pathToFileURL(`${process.cwd()}/.tmp-test/workflow.js`).href);

const { normalizeTask, migrateLegacyWorkerOutput, getIntegrationBlockers } = workflow;

test('normalizeTask supports taskId/taskName legacy fields', () => {
  const normalized = normalizeTask({ taskId: 42, taskName: 'Legacy Task', description: 'd', workerType: 'code', dependencies: [] }, 0);
  assert.equal(normalized.id, '42');
  assert.equal(normalized.name, 'Legacy Task');
});

test('legacy implementation/fullGameCode migrate to changedFiles', () => {
  const task = { id: 'task_1', name: 'a', description: '', workerType: 'code', dependencies: [] };
  const fromImplementation = migrateLegacyWorkerOutput({ implementation: '<html />' }, task);
  const fromFullGameCode = migrateLegacyWorkerOutput({ fullGameCode: 'code' }, task);
  assert.equal(fromImplementation.changedFiles[0].path, 'index.html');
  assert.equal(fromFullGameCode.changedFiles[0].content, 'code');
});

test('legacy structured fields are preserved in result', () => {
  const task = { id: 'task_2', name: 'b', description: '', workerType: 'code', dependencies: [] };
  const migrated = migrateLegacyWorkerOutput({ moduleId: 'm1', coreFunctions: [{ name: 'run' }] }, task);
  assert.match(migrated.result, /moduleId/);
  assert.match(migrated.result, /coreFunctions/);
});

test('failed reviews block integration', () => {
  const plan = { projectName: 'p', summary: 's', tasks: [{ id: 'task_x', name: 'x', description: '', workerType: 'code', dependencies: [] }] };
  const blockers = getIntegrationBlockers(plan, { task_x: { taskId: 'task_x', result: 'r', filesSuggested: [], risks: [], notes: '', changedFiles: [] } }, { task_x: { taskId: 'task_x', passed: false, issues: [], suggestions: [], score: 100 } }, 80);
  assert.deepEqual(blockers, ['task_x']);
});

test('all passed reviews allow integration', () => {
  const plan = { projectName: 'p', summary: 's', tasks: [{ id: 'task_y', name: 'y', description: '', workerType: 'code', dependencies: [] }] };
  const blockers = getIntegrationBlockers(plan, { task_y: { taskId: 'task_y', result: 'r', filesSuggested: [], risks: [], notes: '', changedFiles: [] } }, { task_y: { taskId: 'task_y', passed: true, issues: [], suggestions: [], score: 95 } }, 80);
  assert.deepEqual(blockers, []);
});
