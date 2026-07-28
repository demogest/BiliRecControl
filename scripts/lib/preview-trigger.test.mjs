import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { findPreviewBuildTrigger, triggersPreviewBuild } from './preview-trigger.mjs';

const classifierPath = fileURLToPath(new URL('../should-publish-preview.mjs', import.meta.url));

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function commit(cwd, contents, subject) {
  writeFileSync(join(cwd, 'history.txt'), contents, 'utf8');
  git(cwd, 'add', 'history.txt');
  git(cwd, 'commit', '-m', subject);
}

test('enables preview builds for product and artifact changes', () => {
  const subjects = [
    'feat: add room filters',
    'fix(updater): reject an invalid manifest',
    'perf(history)!: replace the history index',
    'refactor(api): centralize requests',
    'build: update package targets',
    'revert(library): restore the previous ordering',
    'chore(deps): update Tauri'
  ];

  for (const subject of subjects) {
    assert.equal(triggersPreviewBuild(subject), true, subject);
  }
});

test('skips commits that cannot change preview packages', () => {
  const subjects = [
    'docs: clarify portable mode',
    'ci: adjust caching',
    'chore(release): bump version',
    'style: format the dashboard',
    'test(api): cover invalid credentials'
  ];

  for (const subject of subjects) {
    assert.equal(triggersPreviewBuild(subject), false, subject);
  }
});

test('requires a valid conventional commit subject', () => {
  assert.equal(triggersPreviewBuild('Feat: add room filters'), false);
  assert.equal(triggersPreviewBuild('feat(BadScope): add room filters'), false);
  assert.equal(triggersPreviewBuild('feat:add room filters'), false);
  assert.equal(triggersPreviewBuild('Add room filters'), false);
});

test('scans every commit in a pushed range', () => {
  const subjects = [
    'docs: update the guide',
    'fix(config): preserve recording settings',
    'ci: tune the cache'
  ];

  assert.equal(findPreviewBuildTrigger(subjects), subjects[1]);
  assert.equal(findPreviewBuildTrigger(['docs: update the guide', 'ci: tune the cache']), '');
});

test('classifies the complete Git push range', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bilirec-preview-trigger-'));
  try {
    git(cwd, 'init');
    git(cwd, 'config', 'user.name', 'CI Test');
    git(cwd, 'config', 'user.email', 'ci-test@example.invalid');
    git(cwd, 'config', 'commit.gpgSign', 'false');

    commit(cwd, 'baseline\n', 'docs: add the baseline');
    const beforeProductPush = git(cwd, 'rev-parse', 'HEAD');
    const initialDecision = execFileSync(
      process.execPath,
      [
        classifierPath,
        '--from',
        '0000000000000000000000000000000000000000',
        '--to',
        beforeProductPush
      ],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    assert.equal(initialDecision, 'false');

    commit(cwd, 'baseline\nfeature\n', 'feat: add room filters');
    commit(cwd, 'baseline\nfeature\nguide\n', 'docs: describe room filters');
    const afterProductPush = git(cwd, 'rev-parse', 'HEAD');

    const productDecision = execFileSync(
      process.execPath,
      [classifierPath, '--from', beforeProductPush, '--to', afterProductPush],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    assert.equal(productDecision, 'true');

    commit(cwd, 'baseline\nfeature\nguide\nmore docs\n', 'docs: clarify room filters');
    const afterDocsPush = git(cwd, 'rev-parse', 'HEAD');
    const docsDecision = execFileSync(
      process.execPath,
      [classifierPath, '--from', afterProductPush, '--to', afterDocsPush],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    assert.equal(docsDecision, 'false');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('blocks preview publishing when the push range is invalid', () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [classifierPath, '--from', 'not-a-commit', '--to', 'also-not-a-commit'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      ),
    (error) => error.status === 1
  );
});

test('blocks preview publishing when a valid-looking commit is unavailable', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bilirec-preview-trigger-'));
  try {
    git(cwd, 'init');
    git(cwd, 'config', 'user.name', 'CI Test');
    git(cwd, 'config', 'user.email', 'ci-test@example.invalid');
    git(cwd, 'config', 'commit.gpgSign', 'false');
    commit(cwd, 'baseline\n', 'docs: add the baseline');
    const currentCommit = git(cwd, 'rev-parse', 'HEAD');

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            classifierPath,
            '--from',
            '0000000000000000000000000000000000000001',
            '--to',
            currentCommit
          ],
          { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        ),
      (error) => error.status === 1
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
