import { describe, expect, it } from 'vitest';
import { parseControlCommand } from './control';

describe('parseControlCommand', () => {
  it('accepts pair and devices', () => {
    expect(parseControlCommand('{"cmd":"pair"}')).toEqual({ cmd: 'pair' });
    expect(parseControlCommand('{"cmd":"devices"}')).toEqual({ cmd: 'devices' });
    expect(parseControlCommand('{"cmd":"update"}')).toEqual({ cmd: 'update' });
    expect(parseControlCommand('{"cmd":"status"}')).toEqual({ cmd: 'status' });
  });

  it('requires an id to revoke', () => {
    expect(parseControlCommand('{"cmd":"revoke","id":" dev "}')).toEqual({
      cmd: 'revoke',
      id: 'dev',
    });
    expect(parseControlCommand('{"cmd":"revoke"}')).toEqual({ error: 'revoke requires id' });
  });

  it('rejects unknown input', () => {
    expect(parseControlCommand('nope')).toEqual({ error: 'invalid json' });
    expect(parseControlCommand('{"cmd":"quit"}')).toEqual({ error: 'unknown command' });
  });
});
