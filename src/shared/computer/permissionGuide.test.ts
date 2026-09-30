import { describe, expect, it } from 'vitest';
import { computerPermissionGuideKind } from './permissionGuide';
import type { ComputerCapabilities } from './types';

function caps(partial: Partial<ComputerCapabilities>): ComputerCapabilities {
  return {
    platform: 'darwin',
    capture: true,
    input: true,
    ax: true,
    backgroundInput: false,
    clipboard: true,
    capturePermission: 'denied',
    inputPermission: 'denied',
    axPermission: 'denied',
    ...partial,
  };
}

describe('computerPermissionGuideKind', () => {
  it('both permissions granted → ready', () => {
    expect(
      computerPermissionGuideKind(
        caps({ capturePermission: 'granted', axPermission: 'granted', inputPermission: 'granted' })
      )
    ).toBe('ready');
  });

  it('missing capture or ax → needs-permission', () => {
    expect(computerPermissionGuideKind(caps({ capturePermission: 'denied' }))).toBe(
      'needs-permission'
    );
    expect(
      computerPermissionGuideKind(caps({ capturePermission: 'granted', axPermission: 'unknown' }))
    ).toBe('needs-permission');
  });

  it('platform cannot operate desktop → unsupported', () => {
    expect(
      computerPermissionGuideKind(
        caps({
          platform: 'win32',
          capture: false,
          input: false,
          ax: false,
          capturePermission: 'unsupported',
          inputPermission: 'unsupported',
          axPermission: 'unsupported',
        })
      )
    ).toBe('unsupported');
  });

  it('AX 不适用（unsupported）不算缺权限', () => {
    expect(
      computerPermissionGuideKind(
        caps({ platform: 'win32', capturePermission: 'granted', axPermission: 'unsupported' })
      )
    ).toBe('ready');
  });
});
