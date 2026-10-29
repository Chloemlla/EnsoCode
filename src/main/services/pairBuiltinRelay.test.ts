import { describe, expect, it } from 'vitest';
import { builtinRelayUrl, dialRelayUrl, publicRelayUrl, setBuiltinRelay } from './pairBuiltinRelay';

describe('pairBuiltinRelay', () => {
  it('maps only the built-in relay between public and local addresses', () => {
    expect(builtinRelayUrl()).toBeNull();
    expect(dialRelayUrl('https://enso.example.com')).toBe('https://enso.example.com');

    setBuiltinRelay('https://enso.example.com/', 'http://127.0.0.1:7878');
    expect(builtinRelayUrl()).toBe('https://enso.example.com');
    expect(dialRelayUrl('https://enso.example.com/')).toBe('http://127.0.0.1:7878');
    expect(publicRelayUrl('http://127.0.0.1:7878')).toBe('https://enso.example.com');
    expect(dialRelayUrl('https://enso-relay.j3.do')).toBe('https://enso-relay.j3.do');
    expect(publicRelayUrl('https://enso-relay.j3.do')).toBe('https://enso-relay.j3.do');
  });
});
