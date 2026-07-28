import { execFileSync } from 'node:child_process';
import { findPreviewBuildTrigger } from './lib/preview-trigger.mjs';

function readArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = value;
    index += 1;
  }
  return result;
}

function assertCommitId(value, name) {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value)) {
    throw new Error(`${name} must be a full Git commit ID`);
  }
}

function commitSubjects(from, to) {
  assertCommitId(from, '--from');
  assertCommitId(to, '--to');

  const isInitialPush = /^0+$/.test(from);
  if (!isInitialPush) {
    execFileSync('git', ['merge-base', '--is-ancestor', from, to], {
      stdio: 'ignore'
    });
  }

  const range = isInitialPush ? to : `${from}..${to}`;
  const output = execFileSync('git', ['log', '--no-merges', '--format=%s', range], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });

  return output
    .split(/\r?\n/)
    .map((subject) => subject.trim())
    .filter(Boolean);
}

try {
  const args = readArguments(process.argv.slice(2));
  const from = typeof args.from === 'string' ? args.from : '';
  const to = typeof args.to === 'string' ? args.to : '';
  const subjects = commitSubjects(from, to);
  const trigger = findPreviewBuildTrigger(subjects);

  if (trigger) {
    process.stderr.write(`Preview package build enabled by commit: ${trigger}\n`);
    process.stdout.write('true');
  } else {
    process.stderr.write(
      'No preview-worthy commits found; signed package publishing will be skipped.\n'
    );
    process.stdout.write('false');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `Unable to inspect the pushed commit range; preview publishing is blocked: ${message}\n`
  );
  process.exitCode = 1;
}
