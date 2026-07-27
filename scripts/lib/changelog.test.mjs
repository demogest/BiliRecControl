import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const generatorPath = fileURLToPath(new URL('../generate-changelog.mjs', import.meta.url));

function git(cwd, ...args) {
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function commit(cwd, filename, contents, subject) {
  writeFileSync(join(cwd, filename), contents, 'utf8');
  git(cwd, 'add', filename);
  git(cwd, 'commit', '-m', subject);
}

test('stable changelog baseline ignores CI preview tags', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'bilirec-changelog-'));
  try {
    git(cwd, 'init');
    git(cwd, 'config', 'user.name', 'CI Test');
    git(cwd, 'config', 'user.email', 'ci-test@example.invalid');
    git(cwd, 'config', 'commit.gpgSign', 'false');
    git(cwd, 'config', 'tag.gpgSign', 'false');

    commit(cwd, 'history.txt', 'stable\n', 'feat: add stable baseline');
    git(cwd, 'tag', 'v1.4.9');
    commit(cwd, 'history.txt', 'stable\npreview\n', 'feat(updater): add preview channel');
    git(cwd, 'tag', 'v1.4.10-beta.123.1');
    commit(
      cwd,
      'history.txt',
      'stable\npreview\nhardening\n',
      'fix(updater): harden preview promotion'
    );

    const outputPath = join(cwd, 'notes.md');
    execFileSync(
      process.execPath,
      [
        generatorPath,
        '--auto-from',
        '--to',
        'HEAD',
        '--version',
        'v1.4.10-beta.124.1',
        '--preview',
        '--strict',
        '--output',
        outputPath
      ],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    const notes = readFileSync(outputPath, 'utf8');
    assert.match(notes, /add preview channel/);
    assert.match(notes, /harden preview promotion/);
    assert.doesNotMatch(notes, /add stable baseline/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
