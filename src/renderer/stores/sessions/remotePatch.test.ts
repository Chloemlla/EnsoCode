import { describe, expect, it } from 'vitest';
import { applyConversationsPatchToState } from './remotePatch';

type Row = Record<string, unknown>;
const row = (id: string, extra: Row = {}): Row => ({
  id,
  projectId: 'p',
  title: id,
  started: false,
  status: 'idle',
  messages: [],
  createdAt: 1,
  ...extra,
});

const state = (conversations: Record<string, Row>, order: string[], activeId: string | null) => ({
  conversations,
  order,
  activeId,
  unrelated: 1,
});

describe('applyConversationsPatchToState', () => {
  it('merges only non-runtime fields into existing conversations', () => {
    const messages = [{ role: 'user', text: 'hi' }];
    const before = state(
      { a: row('a', { started: true, status: 'running', messages, pinned: true }) },
      ['a'],
      'a'
    );
    const next = applyConversationsPatchToState(before, {
      upserts: {
        a: {
          set: { title: 'renamed', status: 'idle', started: false, messages: [] },
          unset: ['pinned', 'error'],
        },
      },
      removes: [],
    });
    expect(next.conversations.a).toEqual({
      ...row('a', { started: true, status: 'running', messages }),
      title: 'renamed',
    });
    expect(next.conversations.a.messages).toBe(messages);
    expect(next.order).toEqual(['a']);
  });

  it('keeps runtime keys listed in unset', () => {
    const before = state({ a: row('a', { error: 'boom' }) }, ['a'], 'a');
    const next = applyConversationsPatchToState(before, {
      upserts: { a: { set: {}, unset: ['error'] } },
      removes: [],
    });
    expect(next.conversations.a.error).toBe('boom');
  });

  it('inserts new conversations as persisted rows and prepends them to order', () => {
    const before = state({ a: row('a') }, ['a'], 'a');
    const incoming = row('b', { title: 'remote' });
    const next = applyConversationsPatchToState(before, {
      upserts: { b: { set: incoming, unset: [] } },
      removes: [],
    });
    expect(next.conversations.b).toEqual(incoming);
    expect(next.order).toEqual(['b', 'a']);
    expect(next.activeId).toBe('a');
  });

  it('removes conversations and moves activeId to the next in order', () => {
    const before = state({ a: row('a'), b: row('b'), c: row('c') }, ['a', 'b', 'c'], 'a');
    const next = applyConversationsPatchToState(before, { upserts: {}, removes: ['a'] });
    expect(Object.keys(next.conversations)).toEqual(['b', 'c']);
    expect(next.order).toEqual(['b', 'c']);
    expect(next.activeId).toBe('b');

    const kept = applyConversationsPatchToState(before, { upserts: {}, removes: ['c'] });
    expect(kept.activeId).toBe('a');

    const empty = applyConversationsPatchToState(state({ a: row('a') }, ['a'], 'a'), {
      upserts: {},
      removes: ['a'],
    });
    expect(empty.activeId).toBeNull();
  });

  it('applies patch order while keeping local-only conversations such as btw', () => {
    const before = state(
      { a: row('a'), b: row('b'), btw: row('btw', { btwParentId: 'a' }) },
      ['btw', 'a', 'b'],
      'a'
    );
    const next = applyConversationsPatchToState(before, {
      upserts: {},
      removes: [],
      order: ['b', 'a', 'gone'],
    });
    expect(next.order).toEqual(['btw', 'b', 'a']);
  });
});
