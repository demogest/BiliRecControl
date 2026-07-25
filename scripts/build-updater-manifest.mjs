import { writeFileSync } from 'node:fs';

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

const packages = [
  {
    name: `BiliRec.Control_${version}_x64-setup.exe`,
    platforms: ['windows-x86_64', 'windows-x86_64-nsis']
  },
  {
    name: `BiliRec.Control_${version}_x64_en-US.msi`,
    platforms: ['windows-x86_64-msi']
  },
  {
    name: `BiliRec.Control_${version}_arm64-setup.exe`,
    platforms: ['windows-aarch64', 'windows-aarch64-nsis']
  },
  {
    name: `BiliRec.Control_${version}_amd64.AppImage`,
    platforms: ['linux-x86_64', 'linux-x86_64-appimage']
  },
  {
    name: `BiliRec.Control_${version}_amd64.deb`,
    platforms: ['linux-x86_64-deb']
  },
  {
    name: `BiliRec.Control-${version}-1.x86_64.rpm`,
    platforms: ['linux-x86_64-rpm']
  },
  {
    name: `BiliRec.Control_${version}_aarch64.AppImage`,
    platforms: ['linux-aarch64', 'linux-aarch64-appimage']
  },
  {
    name: `BiliRec.Control_${version}_arm64.deb`,
    platforms: ['linux-aarch64-deb']
  },
  {
    name: `BiliRec.Control-${version}-1.aarch64.rpm`,
    platforms: ['linux-aarch64-rpm']
  },
  {
    name: `BiliRec.Control_${version}_x64.app.tar.gz`,
    platforms: ['darwin-x86_64', 'darwin-x86_64-app']
  },
  {
    name: `BiliRec.Control_${version}_aarch64.app.tar.gz`,
    platforms: ['darwin-aarch64', 'darwin-aarch64-app']
  },
  {
    name: `BiliRec.Control_${version}_universal.app.tar.gz`,
    platforms: ['darwin-universal', 'darwin-universal-app']
  }
];

const platforms = {};
for (const entry of packages) {
  const asset = assetsByName.get(entry.name);
  const signatureAsset = assetsByName.get(`${entry.name}.sig`);
  if (!asset || !signatureAsset) {
    throw new Error(`Release package or signature is missing: ${entry.name}`);
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
      url: asset.url
    };
  }
}

if (Object.keys(platforms).length !== 19) {
  throw new Error(`Expected 19 updater platform mappings, got ${Object.keys(platforms).length}.`);
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

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(
  `Generated ${outputPath} with ${Object.keys(platforms).length} signed platform mappings.\n`
);
