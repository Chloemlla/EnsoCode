export type ComputerPermissionKind = 'screen' | 'accessibility';

export async function promptComputerPermission(
  kind: ComputerPermissionKind,
  deps: {
    requestScreen: () => boolean | Promise<boolean>;
    requestAx: (prompt: boolean) => boolean;
    openSettings: (kind: ComputerPermissionKind) => void;
  }
): Promise<boolean> {
  const granted = kind === 'accessibility' ? deps.requestAx(true) : await deps.requestScreen();
  if (!granted) deps.openSettings(kind);
  return granted;
}
