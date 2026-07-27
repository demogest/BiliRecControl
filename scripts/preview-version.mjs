import { comparePreviewVersions, nextPreviewVersion } from './lib/preview-version.mjs';

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

const args = readArguments(process.argv.slice(2));
if (typeof args.candidate === 'string' && typeof args.current === 'string') {
  process.stdout.write(comparePreviewVersions(args.candidate, args.current) > 0 ? 'true' : 'false');
} else {
  const base = typeof args.base === 'string' ? args.base : '';
  const runNumber = typeof args['run-number'] === 'string' ? args['run-number'] : '';
  const runAttempt = typeof args['run-attempt'] === 'string' ? args['run-attempt'] : '1';
  process.stdout.write(nextPreviewVersion(base, runNumber, runAttempt));
}
