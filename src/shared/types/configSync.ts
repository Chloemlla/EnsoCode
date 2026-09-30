export type ConfigSyncMode = 'merge' | 'replace';

export type ConfigSyncCategory =
  | 'providers'
  | 'presets'
  | 'agentTypes'
  | 'skills'
  | 'mcpServers'
  | 'instructions'
  | 'subagentModels'
  | 'settings';

export interface ConfigSyncSummary {
  category: ConfigSyncCategory;
  added: number;
  updated: number;
  skipped: number;
  removed?: number;
  /** 设置摘要仅列字段名，不包含值或凭证。 */
  fields?: string[];
}

export interface ConfigSyncExportOptions {
  includeSecrets: boolean;
  password?: string;
}

export type ConfigSyncExportResult =
  | { ok: true; filePath: string; skippedInstructions?: string[] }
  | { ok: false; error: string; cancelled?: boolean };

export type ConfigSyncOpenResult =
  | { ok: true; token: string; encrypted: boolean; fileName: string }
  | { ok: false; error: string; cancelled?: boolean };

export interface ConfigSyncPreviewOptions {
  token: string;
  password?: string;
  mode: ConfigSyncMode;
}

export type ConfigSyncPreviewResult =
  | {
      ok: true;
      summary: ConfigSyncSummary[];
      warnings: string[];
      mode: ConfigSyncMode;
    }
  | { ok: false; error: string; cancelled?: boolean };

export interface ConfigSyncCommitOptions {
  token: string;
  mode: ConfigSyncMode;
}

export type ConfigSyncCommitResult =
  | { ok: true; backupPath: string; warnings: string[] }
  | { ok: false; error: string; cancelled?: boolean };
