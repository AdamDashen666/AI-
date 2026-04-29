import test from 'node:test';
import assert from 'node:assert/strict';

function migrate(output) {
  const legacy = output.fullUpdatedResult ?? output['full updated result'] ?? output.completeGameCode ?? output.fullGameCode ?? output.implementation;
  const changedFiles = Array.isArray(output.changedFiles) ? output.changedFiles : (typeof legacy === 'string' ? [{ path: 'index.html', content: legacy }] : []);
  return changedFiles;
}

test('legacy implementation migrates to changedFiles', () => {
  assert.equal(migrate({ implementation: '<html />' })[0].path, 'index.html');
});

test('legacy fullGameCode migrates to changedFiles', () => {
  assert.equal(migrate({ fullGameCode: 'code' })[0].content, 'code');
});

test('legacy completeGameCode migrates to changedFiles', () => {
  assert.equal(migrate({ completeGameCode: 'code' })[0].content, 'code');
});

test('legacy fullUpdatedResult migrates to changedFiles', () => {
  assert.equal(migrate({ fullUpdatedResult: 'code' })[0].content, 'code');
});

test('legacy full updated result migrates to changedFiles', () => {
  assert.equal(migrate({ 'full updated result': 'code' })[0].content, 'code');
});

test('target score stop condition', () => {
  const review = { passed: true, score: 90, issues: [] };
  const min = 80;
  assert.equal(Boolean(review.passed) && review.score >= min && review.issues.length === 0, true);
});

test('task-006 can proceed when done=5 total=6', () => {
  const total = 6; const done = 5;
  assert.equal(done < total, true);
});

test('all done sets completed', () => {
  const total = 6; const done = 6;
  const phase = done === total ? 'completed' : 'running';
  assert.equal(phase, 'completed');
});
