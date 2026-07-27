const STABLE_PACKAGE_TEMPLATES = [
  {
    name: (version) => `BiliRec.Control_${version}_x64-setup.exe`,
    platforms: ['windows-x86_64', 'windows-x86_64-nsis']
  },
  {
    name: (version) => `BiliRec.Control_${version}_x64_en-US.msi`,
    platforms: ['windows-x86_64-msi']
  },
  {
    name: (version) => `BiliRec.Control_${version}_arm64-setup.exe`,
    platforms: ['windows-aarch64', 'windows-aarch64-nsis']
  },
  {
    name: (version) => `BiliRec.Control_${version}_amd64.AppImage`,
    platforms: ['linux-x86_64', 'linux-x86_64-appimage']
  },
  {
    name: (version) => `BiliRec.Control_${version}_amd64.deb`,
    platforms: ['linux-x86_64-deb']
  },
  {
    name: (version) => `BiliRec.Control-${version}-1.x86_64.rpm`,
    platforms: ['linux-x86_64-rpm']
  },
  {
    name: (version) => `BiliRec.Control_${version}_aarch64.AppImage`,
    platforms: ['linux-aarch64', 'linux-aarch64-appimage']
  },
  {
    name: (version) => `BiliRec.Control_${version}_arm64.deb`,
    platforms: ['linux-aarch64-deb']
  },
  {
    name: (version) => `BiliRec.Control-${version}-1.aarch64.rpm`,
    platforms: ['linux-aarch64-rpm']
  },
  {
    name: (version) => `BiliRec.Control_${version}_x64.app.tar.gz`,
    platforms: ['darwin-x86_64', 'darwin-x86_64-app']
  },
  {
    name: (version) => `BiliRec.Control_${version}_aarch64.app.tar.gz`,
    platforms: ['darwin-aarch64', 'darwin-aarch64-app']
  },
  {
    name: (version) => `BiliRec.Control_${version}_universal.app.tar.gz`,
    platforms: ['darwin-universal', 'darwin-universal-app']
  }
];

const PREVIEW_PACKAGE_TEMPLATES = [
  {
    name: (version) => `BiliRec.Control_${version}_x64-setup.exe`,
    platforms: ['windows-x86_64', 'windows-x86_64-nsis']
  },
  {
    name: (version) => `BiliRec.Control_${version}_amd64.AppImage`,
    platforms: ['linux-x86_64', 'linux-x86_64-appimage']
  },
  {
    name: (version) => `BiliRec.Control_${version}_amd64.deb`,
    platforms: ['linux-x86_64-deb']
  },
  {
    name: (version) => `BiliRec.Control_${version}_universal.app.tar.gz`,
    platforms: ['darwin-x86_64', 'darwin-x86_64-app', 'darwin-aarch64', 'darwin-aarch64-app']
  }
];

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function assertRepository(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }
}

export function assertUpdaterReleaseTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v') || !SEMVER_PATTERN.test(tag.slice(1))) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
}

export function updaterPackagesForVersion(version) {
  return packagesFromTemplates(version, STABLE_PACKAGE_TEMPLATES);
}

export function previewUpdaterPackagesForVersion(version) {
  return packagesFromTemplates(version, PREVIEW_PACKAGE_TEMPLATES);
}

function packagesFromTemplates(version, templates) {
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new Error(`Invalid updater version: ${version}`);
  }

  return templates.map((entry) => ({
    name: entry.name(version),
    platforms: [...entry.platforms]
  }));
}

export function updaterPackagesForChannel(version, channel = 'stable') {
  if (channel === 'stable') return updaterPackagesForVersion(version);
  if (channel === 'preview') return previewUpdaterPackagesForVersion(version);
  throw new Error(`Invalid updater channel: ${channel}`);
}

export function publicReleaseAssetUrl(repository, tag, assetName) {
  assertRepository(repository);
  assertUpdaterReleaseTag(tag);
  if (!assetName || /[\\/]/.test(assetName)) {
    throw new Error(`Invalid release asset name: ${assetName}`);
  }

  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`;
}

export function assertPublicReleaseAssetUrl(url, { repository, tag, assetName }) {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error(`Release asset has no public download URL: ${assetName}`);
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Release asset has an invalid download URL: ${assetName}`);
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'github.com' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`Release asset URL is not a public GitHub HTTPS URL: ${url}`);
  }

  const expected = publicReleaseAssetUrl(repository, tag, assetName);
  if (parsed.href !== expected) {
    throw new Error(
      `Release asset URL must target the current repository and tag.\nExpected: ${expected}\nActual:   ${parsed.href}`
    );
  }

  return parsed.href;
}

export function assertUploadedReleaseAsset(asset, context) {
  if (!asset || typeof asset !== 'object') {
    throw new Error(`Release asset is missing: ${context.assetName}`);
  }
  if (asset.state !== 'uploaded') {
    throw new Error(
      `Release asset is not ready: ${context.assetName} (${asset.state || 'unknown'})`
    );
  }
  if (!Number.isFinite(asset.size) || asset.size <= 0) {
    throw new Error(`Release asset is empty: ${context.assetName}`);
  }

  return assertPublicReleaseAssetUrl(asset.browser_download_url, context);
}

export function validateUpdaterManifest(manifest, { repository, tag, channel = 'stable' }) {
  assertRepository(repository);
  assertUpdaterReleaseTag(tag);

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Updater manifest must be a JSON object.');
  }

  const expectedVersion = tag.replace(/^v/, '');
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `Updater manifest version ${manifest.version || '(missing)'} does not match ${expectedVersion}.`
    );
  }
  if (typeof manifest.notes !== 'string' || !manifest.notes.trim()) {
    throw new Error('Updater manifest release notes are empty.');
  }
  if (typeof manifest.pub_date !== 'string' || Number.isNaN(Date.parse(manifest.pub_date))) {
    throw new Error('Updater manifest pub_date is missing or invalid.');
  }
  if (
    !manifest.platforms ||
    typeof manifest.platforms !== 'object' ||
    Array.isArray(manifest.platforms)
  ) {
    throw new Error('Updater manifest platforms must be an object.');
  }

  const expectedEntries = updaterPackagesForChannel(expectedVersion, channel).flatMap((entry) =>
    entry.platforms.map((platform) => [platform, entry.name])
  );
  const expectedPlatforms = new Set(expectedEntries.map(([platform]) => platform));
  const actualPlatforms = Object.keys(manifest.platforms);
  const missing = [...expectedPlatforms].filter((platform) => !(platform in manifest.platforms));
  const unexpected = actualPlatforms.filter((platform) => !expectedPlatforms.has(platform));
  if (missing.length || unexpected.length) {
    throw new Error(
      `Updater platform mappings do not match the supported set. Missing: ${
        missing.join(', ') || 'none'
      }; unexpected: ${unexpected.join(', ') || 'none'}.`
    );
  }

  const signaturesByUrl = new Map();
  for (const [platform, assetName] of expectedEntries) {
    const entry = manifest.platforms[platform];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Updater platform entry is invalid: ${platform}`);
    }
    if (typeof entry.signature !== 'string' || entry.signature.trim().length < 64) {
      throw new Error(`Updater signature is missing or too short: ${platform}`);
    }

    const url = assertPublicReleaseAssetUrl(entry.url, { repository, tag, assetName });
    const previousSignature = signaturesByUrl.get(url);
    if (previousSignature && previousSignature !== entry.signature.trim()) {
      throw new Error(`Updater aliases use different signatures for the same asset: ${url}`);
    }
    signaturesByUrl.set(url, entry.signature.trim());
  }

  return {
    platformCount: actualPlatforms.length,
    uniqueAssetCount: signaturesByUrl.size,
    urls: [...signaturesByUrl.keys()]
  };
}

export async function probeUpdaterPackageUrls(
  manifest,
  { repository, tag, channel = 'stable', timeout = 30_000 }
) {
  const summary = validateUpdaterManifest(manifest, { repository, tag, channel });

  for (const url of summary.urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await fetch(url, {
        redirect: 'follow',
        headers: {
          Range: 'bytes=0-0',
          'User-Agent': 'BiliRecControl-updater-smoke-test'
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Anonymous package probe returned HTTP ${response.status}: ${url}`);
      }
      const contentType = response.headers.get('content-type')?.toLowerCase() || '';
      if (contentType.includes('text/html') || contentType.includes('application/json')) {
        throw new Error(
          `Anonymous package probe returned ${contentType || 'an invalid response'} instead of an installer: ${url}`
        );
      }
    } finally {
      clearTimeout(timer);
      await response?.body?.cancel().catch(() => undefined);
    }
  }

  return summary;
}
