import { describe, expect, it } from 'vitest';
import { serviceUnit } from './service';

describe('serviceUnit', () => {
  it('runs the installed cli in the foreground and restarts it', () => {
    const unit = serviceUnit({
      node: '/usr/bin/node',
      script: '/usr/lib/node_modules/@ensocode/server/out/server/index.js',
      user: 'root',
      env: { ENSO_DATA_DIR: '/root/.enso-server', ENSO_RELAY_URL: 'https://r.example' },
    });
    expect(unit).toContain(
      'ExecStart=/usr/bin/node /usr/lib/node_modules/@ensocode/server/out/server/index.js start'
    );
    expect(unit).toContain('User=root');
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('Environment="ENSO_DATA_DIR=/root/.enso-server"');
    expect(unit).toContain('Environment="ENSO_RELAY_URL=https://r.example"');
    expect(unit).toContain('WantedBy=multi-user.target');
  });

  it('omits User= for user units and quotes paths with spaces', () => {
    const unit = serviceUnit({ node: '/opt/my node/node', script: '/a/index.js', env: {} });
    expect(unit).not.toContain('User=');
    expect(unit).toContain('ExecStart="/opt/my node/node" /a/index.js start');
    expect(unit).toContain('WantedBy=default.target');
  });
});
