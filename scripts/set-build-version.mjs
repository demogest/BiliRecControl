import { readFileSync, writeFileSync } from 'node:fs';
import {
  parsePreviewVersion,
  replaceCargoLockPackageVersion,
  replaceCargoPackageVersion
} from './lib/preview-version.mjs';

function readArguments(argv) {
  const versionIndex = argv.indexOf('--version');
  return versionIndex >= 0 ? argv[versionIndex + 1] : '';
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const version = readArguments(process.argv.slice(2));
parsePreviewVersion(version);

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const tauriConfig = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const cargoManifest = readFileSync('src-tauri/Cargo.toml', 'utf8');
const cargoLock = readFileSync('src-tauri/Cargo.lock', 'utf8');

packageJson.version = version;
packageLock.version = version;
if (!packageLock.packages?.['']) {
  throw new Error('package-lock.json is missing the root package entry.');
}
packageLock.packages[''].version = version;
tauriConfig.version = version;

writeJson('package.json', packageJson);
writeJson('package-lock.json', packageLock);
writeJson('src-tauri/tauri.conf.json', tauriConfig);
writeFileSync('src-tauri/Cargo.toml', replaceCargoPackageVersion(cargoManifest, version), 'utf8');
writeFileSync(
  'src-tauri/Cargo.lock',
  replaceCargoLockPackageVersion(cargoLock, 'bilirec-control', version),
  'utf8'
);

process.stdout.write(`Prepared signed CI preview build ${version}.\n`);
