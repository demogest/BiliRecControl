const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PREVIEW_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.([1-9]\d*)\.([1-9]\d*)$/;

function positiveInteger(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== String(value)) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

export function nextPreviewVersion(baseVersion, runNumber, runAttempt = 1) {
  const match = typeof baseVersion === 'string' ? STABLE_VERSION_PATTERN.exec(baseVersion) : null;
  if (!match) {
    throw new Error(`Preview builds require a stable x.y.z base version: ${baseVersion}`);
  }

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);
  if (patch >= Number.MAX_SAFE_INTEGER) {
    throw new Error(`Base patch version is too large: ${baseVersion}`);
  }

  return `${major}.${minor}.${patch + 1}-beta.${positiveInteger(
    runNumber,
    'runNumber'
  )}.${positiveInteger(runAttempt, 'runAttempt')}`;
}

export function parsePreviewVersion(version) {
  const match = typeof version === 'string' ? PREVIEW_VERSION_PATTERN.exec(version) : null;
  if (!match) {
    throw new Error(`Invalid CI preview version: ${version}`);
  }

  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

export function comparePreviewVersions(left, right) {
  const leftParts = parsePreviewVersion(left);
  const rightParts = parsePreviewVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }
  return 0;
}

export function replaceCargoPackageVersion(source, version) {
  parsePreviewVersion(version);
  const lines = source.split(/\r?\n/);
  let inPackageSection = false;
  let replacementCount = 0;

  const updated = lines.map((line) => {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (section) {
      inPackageSection = section[1] === 'package';
      return line;
    }
    if (inPackageSection && /^\s*version\s*=/.test(line)) {
      replacementCount += 1;
      return `version = "${version}"`;
    }
    return line;
  });

  if (replacementCount !== 1) {
    throw new Error(`Expected one [package] version in Cargo.toml, found ${replacementCount}.`);
  }
  return updated.join('\n');
}

export function replaceCargoLockPackageVersion(source, packageName, version) {
  parsePreviewVersion(version);
  const blocks = source.split(/(?=^\[\[package\]\]\s*$)/m);
  let replacementCount = 0;
  const updated = blocks.map((block) => {
    if (
      !new RegExp(`^name = "${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"$`, 'm').test(
        block
      )
    ) {
      return block;
    }
    replacementCount += 1;
    return block.replace(/^version = "[^"]+"$/m, `version = "${version}"`);
  });

  if (replacementCount !== 1) {
    throw new Error(
      `Expected one ${packageName} package in Cargo.lock, found ${replacementCount}.`
    );
  }
  return updated.join('');
}
