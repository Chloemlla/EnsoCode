import path from 'node:path';
import { app } from '@platform';
import type { PrivacyMaskRecord } from '@shared/privacyMask/report';
import { appendLedger, collectRecords } from './records';

const DAY = 86_400_000;
const ledgerFile = () => path.join(app.getPath('userData'), 'privacy-mask', 'ledger.jsonl');

export function recordPrivacyMaskLedger(record: PrivacyMaskRecord): void {
  void appendLedger(ledgerFile(), record).catch(() => {});
}

export const PRIVACY_RECORD_DAYS = [1, 7, 30] as const;
export type PrivacyRecordDays = (typeof PRIVACY_RECORD_DAYS)[number];

export function listPrivacyMaskRecords(days: PrivacyRecordDays): Promise<PrivacyMaskRecord[]> {
  return collectRecords({
    sessionDir: path.join(app.getPath('userData'), 'agent', 'sessions'),
    ledgerFile: ledgerFile(),
    since: Date.now() - days * DAY,
  });
}
