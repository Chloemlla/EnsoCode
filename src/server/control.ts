export type ControlCommand =
  | { cmd: 'pair' }
  | { cmd: 'devices' }
  | { cmd: 'update' }
  | { cmd: 'status' }
  | { cmd: 'revoke'; id: string };

export function parseControlCommand(line: string): ControlCommand | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { error: 'invalid json' };
  }
  if (!parsed || typeof parsed !== 'object') return { error: 'invalid command' };
  const cmd = (parsed as { cmd?: unknown }).cmd;
  if (cmd === 'pair' || cmd === 'devices' || cmd === 'update' || cmd === 'status') return { cmd };
  if (cmd === 'revoke') {
    const id = (parsed as { id?: unknown }).id;
    if (typeof id !== 'string' || !id.trim()) return { error: 'revoke requires id' };
    return { cmd, id: id.trim() };
  }
  return { error: 'unknown command' };
}
