import assert from 'node:assert/strict';
import test from 'node:test';
import {
  comparePreviewVersions,
  nextPreviewVersion,
  parsePreviewVersion,
  replaceCargoLockPackageVersion,
  replaceCargoPackageVersion
} from './preview-version.mjs';

test('derives a monotonically increasing next-patch preview version', () => {
  assert.equal(nextPreviewVersion('1.4.9', 123, 1), '1.4.10-beta.123.1');
  assert.equal(nextPreviewVersion('1.4.9', 123, 2), '1.4.10-beta.123.2');
  assert.equal(nextPreviewVersion('1.4.10', 124, 1), '1.4.11-beta.124.1');
  assert.ok(comparePreviewVersions('1.4.10-beta.124.1', '1.4.10-beta.123.9') > 0);
  assert.ok(comparePreviewVersions('1.5.0-beta.1.1', '1.4.999-beta.999.9') > 0);
});

test('rejects prerelease bases and malformed CI identifiers', () => {
  assert.throws(() => nextPreviewVersion('1.4.9-beta.1', 2, 1), /stable x\.y\.z base/);
  assert.throws(() => nextPreviewVersion('01.4.9', 2, 1), /stable x\.y\.z base/);
  assert.throws(() => nextPreviewVersion('1.4.9', 0, 1), /positive integer/);
  assert.throws(() => parsePreviewVersion('1.4.10-beta.0.1'), /Invalid CI preview/);
});

test('updates only the root Cargo package version', () => {
  const cargo = `[package]
name = "demo"
version = "1.4.9"

[dependencies]
version = "9"
`;
  const updated = replaceCargoPackageVersion(cargo, '1.4.10-beta.50.2');
  assert.match(updated, /\[package\]\nname = "demo"\nversion = "1\.4\.10-beta\.50\.2"/);
  assert.match(updated, /\[dependencies\]\nversion = "9"/);
});

test('updates only the application package in Cargo.lock', () => {
  const lock = `version = 4

[[package]]
name = "bilirec-control"
version = "1.4.9"
dependencies = []

[[package]]
name = "dependency"
version = "1.4.9"
`;
  const updated = replaceCargoLockPackageVersion(lock, 'bilirec-control', '1.4.10-beta.50.2');
  assert.match(updated, /name = "bilirec-control"\nversion = "1\.4\.10-beta\.50\.2"/);
  assert.match(updated, /name = "dependency"\nversion = "1\.4\.9"/);
});
