import type { ComputerCapabilities } from './types';

export type ComputerPermissionGuideKind = 'unsupported' | 'needs-permission' | 'ready';

export function computerPermissionGuideKind(
  caps: ComputerCapabilities
): ComputerPermissionGuideKind {
  if (caps.capturePermission === 'unsupported' && caps.axPermission === 'unsupported') {
    return 'unsupported';
  }
  if (
    caps.capturePermission === 'granted' &&
    (caps.axPermission === 'granted' || caps.axPermission === 'unsupported')
  ) {
    return 'ready';
  }
  return 'needs-permission';
}
