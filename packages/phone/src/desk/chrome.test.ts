import { describe, expect, it } from 'vitest';
import { parseDeskChrome, serializeDeskChrome } from './chrome';

describe('desk chrome cache', () => {
  it('round-trips the edge colors used for the next launch', () => {
    const raw = serializeDeskChrome({ top: 'rgb(255, 255, 255)', bottom: 'rgb(9, 9, 16)' });
    expect(parseDeskChrome(raw)).toEqual({ top: 'rgb(255, 255, 255)', bottom: 'rgb(9, 9, 16)' });
  });

  it('ignores anything that is not a plain rgb color', () => {
    for (const raw of [
      null,
      '',
      '{',
      '{"top":"red","bottom":"rgb(1, 2, 3)"}',
      '{"top":"rgb(1, 2, 3); x: url(y)","bottom":"rgb(1, 2, 3)"}',
    ]) {
      expect(parseDeskChrome(raw)).toBeNull();
    }
  });
});
