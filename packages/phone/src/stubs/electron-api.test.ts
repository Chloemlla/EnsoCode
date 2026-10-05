import { afterEach, expect, it, vi } from 'vitest';
import { installElectronApiShim } from './electron-api';

afterEach(() => vi.unstubAllGlobals());

it('supports shared OAuth timeline metadata without exposing desktop accounts', async () => {
  vi.stubGlobal('window', {});
  installElectronApiShim();
  expect(await window.electronAPI.providers.listOauth()).toEqual([]);
});
