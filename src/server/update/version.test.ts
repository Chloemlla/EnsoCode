import { describe, expect, it } from 'vitest';
import { compareVersions, npmLatestUrl, parseNpmLatest } from './version';

describe('compareVersions', () => {
  it('orders numeric parts and treats prereleases as older', () => {
    expect(compareVersions('0.2.12', '0.2.13')).toBeLessThan(0);
    expect(compareVersions('v0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', 'v1.0.0')).toBe(0);
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0);
  });

  it('never reports garbage as newer', () => {
    expect(compareVersions('0.2.12', 'latest')).toBe(0);
    expect(compareVersions('dev', '0.2.12')).toBe(0);
  });
});

describe('npm registry', () => {
  it('builds the dist-tag url with an encoded scope', () => {
    expect(npmLatestUrl('https://registry.npmjs.org/', '@ensocode/server')).toBe(
      'https://registry.npmjs.org/@ensocode%2fserver/latest'
    );
  });

  it('accepts only a semver version from the manifest', () => {
    expect(parseNpmLatest({ name: '@ensocode/server', version: '0.3.0' })).toBe('0.3.0');
    expect(parseNpmLatest({ version: 'latest' })).toBeNull();
    expect(parseNpmLatest('0.3.0')).toBeNull();
    expect(parseNpmLatest(null)).toBeNull();
  });
});
