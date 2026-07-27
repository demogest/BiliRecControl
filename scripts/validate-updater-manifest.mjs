import { readFileSync } from 'node:fs';
import { probeUpdaterPackageUrls, validateUpdaterManifest } from './lib/updater-manifest.mjs';

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
const input = typeof args.input === 'string' ? args.input : '';
const repository =
  typeof args.repository === 'string' ? args.repository : process.env.GITHUB_REPOSITORY || '';
const tag = typeof args.tag === 'string' ? args.tag : process.env.GITHUB_REF_NAME || '';
const channel = typeof args.channel === 'string' ? args.channel : 'stable';

if (!input || !repository || !tag) {
  throw new Error('Required: --input, --repository and --tag.');
}

const manifest = JSON.parse(readFileSync(input, 'utf8'));
const summary = args.probe
  ? await probeUpdaterPackageUrls(manifest, { repository, tag, channel })
  : validateUpdaterManifest(manifest, { repository, tag, channel });

process.stdout.write(
  `Validated ${summary.platformCount} updater mappings for ${summary.uniqueAssetCount} public release assets${
    args.probe ? ' with anonymous downloads' : ''
  }.\n`
);
