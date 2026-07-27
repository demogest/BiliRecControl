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

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const args = readArguments(process.argv.slice(2));
const url = typeof args.url === 'string' ? args.url : '';
const repository =
  typeof args.repository === 'string' ? args.repository : process.env.GITHUB_REPOSITORY || '';
const tag = typeof args.tag === 'string' ? args.tag : process.env.GITHUB_REF_NAME || '';
const attempts = positiveInteger(args.attempts, 12);
const retryDelay = positiveInteger(args['retry-delay'], 5_000);
const timeout = positiveInteger(args.timeout, 30_000);

if (!url || !repository || !tag) {
  throw new Error('Required: --url, --repository and --tag.');
}

const parsedUrl = new URL(url);
if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'github.com') {
  throw new Error(`Updater metadata must be read anonymously from GitHub HTTPS: ${url}`);
}

let lastError;
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(parsedUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'BiliRecControl-updater-smoke-test' },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Updater metadata returned HTTP ${response.status}: ${url}`);
    }

    const manifest = await response.json();
    const summary = args.probe
      ? await probeUpdaterPackageUrls(manifest, { repository, tag, timeout })
      : validateUpdaterManifest(manifest, { repository, tag });
    process.stdout.write(
      `Verified ${url}: ${summary.platformCount} mappings, ${summary.uniqueAssetCount} anonymous package downloads${
        args.probe ? ' probed' : ' declared'
      }.\n`
    );
    lastError = undefined;
    break;
  } catch (error) {
    lastError = error;
    if (attempt < attempts) {
      process.stderr.write(
        `Public updater verification attempt ${attempt}/${attempts} failed: ${
          error instanceof Error ? error.message : String(error)
        }\n`
      );
      await wait(retryDelay);
    }
  } finally {
    clearTimeout(timer);
  }
}

if (lastError) {
  throw lastError;
}
