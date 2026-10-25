import { describe, expect, it } from 'vitest';
import {
  applyConversationsPatch,
  diffConversations,
  isEmptyConversationsPatch,
  parseConversationsPatch,
} from './conversationsPatch';

const blob = (conversations: Record<string, object>, order: string[]) => ({
  state: { conversations, order, activeId: order[0] ?? null },
  version: 3,
});

describe('conversations patch', () => {
  it('diffs field-level changes, removals and order', () => {
    const prev = blob({ a: { id: 'a', title: 'A', pinned: true }, b: { id: 'b', title: 'B' } }, [
      'a',
      'b',
    ]);
    const next = blob({ a: { id: 'a', title: 'A2' }, c: { id: 'c', title: 'C' } }, ['c', 'a']);
    expect(diffConversations(prev, next)).toEqual({
      upserts: {
        a: { set: { title: 'A2' }, unset: ['pinned'] },
        c: { set: { id: 'c', title: 'C' }, unset: [] },
      },
      removes: ['b'],
      order: ['c', 'a'],
    });
  });

  it('produces an empty patch for identical content', () => {
    const value = blob({ a: { id: 'a', goal: { text: 'x' } } }, ['a']);
    expect(isEmptyConversationsPatch(diffConversations(value, structuredClone(value)))).toBe(true);
  });

  it('merges concurrent edits from two renderers without losing either', () => {
    const base = blob({ a: { id: 'a', title: 'A' }, b: { id: 'b', title: 'B' } }, ['a', 'b']);
    // 远端新建 r 并改 a 的标题；桌面并发新建 d 并置顶 b
    const remote = diffConversations(
      base,
      blob({ r: { id: 'r' }, a: { id: 'a', title: 'A!' }, b: { id: 'b', title: 'B' } }, [
        'r',
        'a',
        'b',
      ])
    );
    const desktopDisk = blob(
      { d: { id: 'd' }, a: { id: 'a', title: 'A' }, b: { id: 'b', title: 'B', pinned: true } },
      ['d', 'a', 'b']
    );
    const merged = applyConversationsPatch(desktopDisk, remote) as ReturnType<typeof blob>;
    expect(Object.keys(merged.state.conversations).sort()).toEqual(['a', 'b', 'd', 'r']);
    expect(merged.state.conversations.a).toEqual({ id: 'a', title: 'A!' });
    expect(merged.state.conversations.b).toEqual({ id: 'b', title: 'B', pinned: true });
    expect(merged.state.order).toEqual(['d', 'r', 'a', 'b']);
    expect(merged.version).toBe(3);
    expect(merged.state.activeId).toBe('d');
  });

  it('drops removed ids from order and tolerates garbage targets', () => {
    const patch = { upserts: { n: { set: { id: 'n' }, unset: [] } }, removes: ['a'] };
    expect(applyConversationsPatch(undefined, patch)).toEqual({
      state: { conversations: { n: { id: 'n' } }, order: ['n'] },
    });
    const merged = applyConversationsPatch(blob({ a: { id: 'a' } }, ['a']), patch) as ReturnType<
      typeof blob
    >;
    expect(merged.state.order).toEqual(['n']);
  });

  it('parses only well-formed patches', () => {
    expect(parseConversationsPatch({ upserts: {}, removes: [] })).toEqual({
      upserts: {},
      removes: [],
    });
    expect(parseConversationsPatch({ upserts: { a: { set: 1 } }, removes: [] })).toBeNull();
    expect(parseConversationsPatch(null)).toBeNull();
  });
});
