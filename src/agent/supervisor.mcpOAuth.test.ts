import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AgentWorkerEvent,
  type McpOAuthRefreshResult,
  parseAgentCommand,
} from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { SessionSupervisor } from './supervisor';

describe('supervisor MCP OAuth 续期请求', () => {
  it('向 Main 发 mcp-oauth-refresh，按 requestId 结算各自结果', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'enso-mcp-refresh-'));
    const events: AgentWorkerEvent[] = [];
    const supervisor = new SessionSupervisor({
      agentDir: root,
      sessionDir: root,
      emit: (event) => events.push(event),
    });
    try {
      const request = Reflect.get(supervisor, 'requestMcpOAuthRefresh') as (
        serverId: string,
        rejected?: string
      ) => Promise<McpOAuthRefreshResult>;
      const first = request('srv-1', 'fp-a');
      const second = request('srv-2');
      const requests = events.filter((event) => event.type === 'mcp-oauth-refresh');
      expect(requests).toEqual([
        {
          type: 'mcp-oauth-refresh',
          requestId: expect.any(String),
          serverId: 'srv-1',
          rejected: 'fp-a',
        },
        { type: 'mcp-oauth-refresh', requestId: expect.any(String), serverId: 'srv-2' },
      ]);
      const results: McpOAuthRefreshResult[] = [
        { ok: true, access: { access_token: 'b' } },
        { ok: false, unauthorized: true, error: 'invalid_grant' },
      ];
      for (const index of [1, 0]) {
        const command = parseAgentCommand({
          type: 'mcp-oauth-refresh-result',
          requestId: (requests[index] as { requestId: string }).requestId,
          result: results[index],
        });
        expect(command).not.toBeNull();
        supervisor.handleCommand(command!);
      }
      await expect(first).resolves.toEqual(results[0]);
      await expect(second).resolves.toEqual(results[1]);
    } finally {
      await supervisor.shutdown();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
