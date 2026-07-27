import { writeFileSync } from 'node:fs';
import {
  assertUploadedReleaseAsset,
  updaterPackagesForChannel,
  validateUpdaterManifest
} from './lib/updater-manifest.mjs';

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

async function githubRequest(path, token, accept = 'application/vnd.github+json') {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'User-Agent': 'BiliRecControl-release-workflow',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} ${response.statusText}: ${path}`);
  }

  return response;
}

const args = readArguments(process.argv.slice(2));
const repository =
  typeof args.repository === 'string' ? args.repository : process.env.GITHUB_REPOSITORY || '';
const releaseId = typeof args['release-id'] === 'string' ? args['release-id'] : '';
const tag = typeof args.tag === 'string' ? args.tag : process.env.GITHUB_REF_NAME || '';
const outputPath = typeof args.output === 'string' ? args.output : '';
const channel = typeof args.channel === 'string' ? args.channel : 'stable';
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

if (!repository || !releaseId || !tag || !outputPath || !token) {
  throw new Error(
    'Required: --repository, --release-id, --tag, --output and GITHUB_TOKEN (or GH_TOKEN).'
  );
}

const version = tag.replace(/^v/, '');
const release = await (
  await githubRequest(`/repos/${repository}/releases/${releaseId}`, token)
).json();
const assets = await (
  await githubRequest(`/repos/${repository}/releases/${releaseId}/assets?per_page=100`, token)
).json();
const assetsByName = new Map(assets.map((asset) => [asset.name, asset]));

if (release.tag_name !== tag) {
  throw new Error(`Release ${releaseId} belongs to ${release.tag_name}, not ${tag}.`);
}

const packages = updaterPackagesForChannel(version, channel);

const platforms = {};
for (const entry of packages) {
  const asset = assetsByName.get(entry.name);
  const signatureAsset = assetsByName.get(`${entry.name}.sig`);
  if (!asset || !signatureAsset) {
    throw new Error(`Release package or signature is missing: ${entry.name}`);
  }

  const url = assertUploadedReleaseAsset(asset, {
    repository,
    tag,
    assetName: entry.name,
    releaseIsDraft: release.draft === true
  });
  assertUploadedReleaseAsset(signatureAsset, {
    repository,
    tag,
    assetName: `${entry.name}.sig`,
    releaseIsDraft: release.draft === true
  });
  if (!Number.isInteger(signatureAsset.id) || signatureAsset.id <= 0) {
    throw new Error(`Release signature has no valid GitHub asset id: ${signatureAsset.name}`);
  }

  const signature = (
    await (
      await githubRequest(
        `/repos/${repository}/releases/assets/${signatureAsset.id}`,
        token,
        'application/octet-stream'
      )
    ).text()
  ).trim();
  if (!signature) {
    throw new Error(`Release signature is empty: ${signatureAsset.name}`);
  }

  for (const platform of entry.platforms) {
    platforms[platform] = {
      signature,
      url
    };
  }
}

const expectedPlatformCount = packages.reduce((count, entry) => count + entry.platforms.length, 0);
if (Object.keys(platforms).length !== expectedPlatformCount) {
  throw new Error(
    `Expected ${expectedPlatformCount} ${channel} updater platform mappings, got ${
      Object.keys(platforms).length
    }.`
  );
}

const notes = typeof release.body === 'string' ? release.body.trim() : '';
if (!notes) {
  throw new Error('Release body is empty; refusing to generate an updater manifest without notes.');
}

const manifest = {
  version,
  notes,
  pub_date: release.published_at || new Date().toISOString(),
  platforms
};

validateUpdaterManifest(manifest, { repository, tag, channel });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(
  `Generated ${outputPath} with ${Object.keys(platforms).length} signed platform mappings.\n`
);
