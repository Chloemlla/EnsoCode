import { describe, expect, it } from 'vitest';
import {
  caddyBlock,
  foreignSite,
  isPublicIpv4,
  nipDomain,
  normalizeDomain,
  upsertCaddyBlock,
} from './caddy';

const DEBIAN_DEFAULT = `# The Caddyfile is an easy way to configure your Caddy web server.
#
# Unless the file starts with a global options block, the first
# uncommented line is always the address of your site.

:80 {
	# Set this path to your site's directory.
	root * /usr/share/caddy

	# Enable the static file server.
	file_server
}

# Refer to the Caddy docs for more information:
`;

describe('upsertCaddyBlock', () => {
  const block = caddyBlock('enso.example.com', 7878);

  it('builds a marked reverse proxy block', () => {
    expect(block).toContain('enso.example.com {\n\treverse_proxy 127.0.0.1:7878\n}');
    expect(block.startsWith('# >>> enso-server')).toBe(true);
    expect(block.trimEnd().endsWith('# <<< enso-server')).toBe(true);
  });

  it('replaces a missing or package-default Caddyfile', () => {
    expect(upsertCaddyBlock(null, 'enso.example.com', 7878)).toBe(block);
    expect(upsertCaddyBlock(DEBIAN_DEFAULT, 'enso.example.com', 7878)).toBe(block);
  });

  it('keeps other sites and replaces only its own block', () => {
    const other = 'blog.example.com {\n\tfile_server\n}\n';
    const once = upsertCaddyBlock(other, 'enso.example.com', 7878);
    expect(once).toBe(`${other}\n${block}`);
    const twice = upsertCaddyBlock(once, 'new.example.com', 9000);
    expect(twice).toBe(`${other}\n${caddyBlock('new.example.com', 9000)}`);
  });
});

describe('foreignSite', () => {
  const hand = `{
	email me@example.com
}

(common) {
	encode gzip
}

blog.example.com, https://23-138-76-150.nip.io:443 {
	import common
	reverse_proxy localhost:7878 # hand written
}
`;

  it('finds a hand-written site for the domain and whether it proxies to the port', () => {
    expect(foreignSite(hand, '23-138-76-150.nip.io', 7878)).toEqual({ proxiesHere: true });
    expect(foreignSite(hand, '23-138-76-150.nip.io', 9000)).toEqual({ proxiesHere: false });
    expect(foreignSite(hand, 'blog.example.com', 7878)).toEqual({ proxiesHere: true });
    expect(foreignSite(hand, 'email', 7878)).toBeNull();
    expect(foreignSite(hand, 'common', 7878)).toBeNull();
    expect(foreignSite(null, 'enso.example.com', 7878)).toBeNull();
  });

  it('ignores its own marked block', () => {
    expect(foreignSite(caddyBlock('enso.example.com', 7878), 'enso.example.com', 7878)).toBeNull();
    expect(foreignSite('enso.example.com {\n\tfile_server\n}\n', 'enso.example.com', 7878)).toEqual(
      { proxiesHere: false }
    );
  });
});

describe('domains', () => {
  it('derives nip.io names from public IPv4 only', () => {
    expect(nipDomain('23.138.76.150')).toBe('23-138-76-150.nip.io');
    expect(nipDomain('256.1.1.1')).toBeNull();
    expect(nipDomain('::1')).toBeNull();
    expect(isPublicIpv4('23.138.76.150')).toBe(true);
    for (const ip of [
      '10.0.0.1',
      '172.16.3.4',
      '192.168.1.2',
      '127.0.0.1',
      '100.64.0.1',
      '169.254.1.1',
    ])
      expect(isPublicIpv4(ip)).toBe(false);
  });

  it('normalizes typed domains', () => {
    expect(normalizeDomain(' https://Enso.Example.com/path ')).toBe('enso.example.com');
    expect(normalizeDomain('enso.example.com')).toBe('enso.example.com');
    expect(normalizeDomain('localhost')).toBeNull();
    expect(normalizeDomain('bad domain.com')).toBeNull();
    expect(normalizeDomain('enso.example.com:8443')).toBeNull();
  });
});
