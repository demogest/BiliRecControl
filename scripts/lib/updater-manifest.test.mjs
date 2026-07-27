import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertUploadedReleaseAsset,
  assertUpdaterReleaseTag,
  probeUpdaterPackageUrls,
  publicReleaseAssetUrl,
  updaterPackagesForVersion,
  validateUpdaterManifest
} from './updater-manifest.mjs';

const repository = 'demogest/BiliRecControl';
const tag = 'v1.4.9';
const version = '1.4.9';

function validManifest() {
  const platforms = {};
  for (const entry of updaterPackagesForVersion(version)) {
    for (const platform of entry.platforms) {
      platforms[platform] = {
        signature: 'trusted-signature-'.repeat(8),
        url: publicReleaseAssetUrl(repository, tag, entry.name)
      };
    }
  }

  return {
    version,
    notes: 'Updater validation fixture',
    pub_date: '2026-07-27T00:00:00.000Z',
    platforms
  };
}

test('accepts the complete public updater manifest', () => {
  const summary = validateUpdaterManifest(validManifest(), { repository, tag });
  assert.equal(summary.platformCount, 19);
  assert.equal(summary.uniqueAssetCount, 12);
});

test('rejects GitHub REST API asset URLs', () => {
  const manifest = validManifest();
  manifest.platforms['windows-x86_64'].url =
    'https://api.github.com/repos/demogest/BiliRecControl/releases/assets/123';

  assert.throws(
    () => validateUpdaterManifest(manifest, { repository, tag }),
    /public GitHub HTTPS URL/
  );
});

test('rejects a manifest that points at a different tag', () => {
  const manifest = validManifest();
  manifest.platforms['windows-x86_64'].url =
    'https://github.com/demogest/BiliRecControl/releases/download/v1.4.8/BiliRec.Control_1.4.9_x64-setup.exe';

  assert.throws(
    () => validateUpdaterManifest(manifest, { repository, tag }),
    /current repository and tag/
  );
});

test('rejects incomplete platform mappings', () => {
  const manifest = validManifest();
  delete manifest.platforms['windows-x86_64-nsis'];

  assert.throws(
    () => validateUpdaterManifest(manifest, { repository, tag }),
    /Missing: windows-x86_64-nsis/
  );
});

test('rejects mismatched signatures for aliases of the same package', () => {
  const manifest = validManifest();
  manifest.platforms['windows-x86_64-nsis'].signature = 'different-signature-'.repeat(8);

  assert.throws(
    () => validateUpdaterManifest(manifest, { repository, tag }),
    /different signatures/
  );
});

test('accepts SemVer tags and rejects malformed updater versions', () => {
  assert.doesNotThrow(() => assertUpdaterReleaseTag('v2.0.0-rc.1+build.7'));
  assert.doesNotThrow(() => assertUpdaterReleaseTag('v2.0.0-001alpha.123-foo'));

  for (const invalid of ['vlatest', 'v1..0', 'v1.2.3+', 'v01.2.3', '1.2.3']) {
    assert.throws(() => assertUpdaterReleaseTag(invalid), /Invalid release tag/);
  }
  assert.throws(() => updaterPackagesForVersion('1.2'), /Invalid updater version/);
});

test('requires an uploaded non-empty asset with a canonical browser URL', () => {
  const assetName = updaterPackagesForVersion(version)[0].name;
  const context = { repository, tag, assetName };
  const asset = {
    state: 'uploaded',
    size: 1024,
    browser_download_url: publicReleaseAssetUrl(repository, tag, assetName)
  };

  assert.equal(assertUploadedReleaseAsset(asset, context), asset.browser_download_url);
  assert.throws(() => assertUploadedReleaseAsset({ ...asset, state: 'new' }, context), /not ready/);
  assert.throws(() => assertUploadedReleaseAsset({ ...asset, size: 0 }, context), /empty/);
  assert.throws(
    () =>
      assertUploadedReleaseAsset(
        {
          ...asset,
          browser_download_url:
            'https://api.github.com/repos/demogest/BiliRecControl/releases/assets/123'
        },
        context
      ),
    /public GitHub HTTPS URL/
  );
});

test('anonymous probes reject a successful HTML response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('<html>sign in</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });

  try {
    await assert.rejects(
      () => probeUpdaterPackageUrls(validManifest(), { repository, tag }),
      /instead of an installer/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
