import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from '@platform';
import { setBuiltinRelay } from '../../main/services/pairBuiltinRelay';
import { bundleManifest } from '../../main/services/remoteRenderer/assets';
import type { WebConfig } from './config';
import { PairStore } from './pairStore';
import { createRelayServer, type RelayServer } from './relayServer';

const LOOPBACK = /^(127\.|localhost$|\[::1\]$)/;

/** npm 包里在 out/phone；源码仓库里直接用 packages/phone/dist */
function phoneDir(): string | null {
  const root = app.getAppPath();
  return (
    [path.join(root, 'out/phone'), path.join(root, 'packages/phone/dist')].find((dir) =>
      existsSync(path.join(dir, 'index.html'))
    ) ?? null
  );
}

/** 起内置 web 并让配对改走它；须在 startPairHost 之前调用 */
export async function startWeb(web: WebConfig): Promise<RelayServer> {
  const staticDir = phoneDir();
  const rendererRoot = path.join(app.getAppPath(), 'out', 'renderer');
  const relay = createRelayServer({
    store: new PairStore(path.join(app.getPath('userData'), 'relay-pairs.json')),
    staticDir,
    desk: async () => {
      const bundle = await bundleManifest(rendererRoot, app.getVersion());
      return bundle && { id: bundle.id, manifest: bundle.text, root: rendererRoot };
    },
  });
  await new Promise<void>((resolve, reject) => {
    relay.server.once('error', reject);
    relay.server.listen(web.port, web.host, () => {
      relay.server.off('error', reject);
      resolve();
    });
  });
  setBuiltinRelay(web.publicUrl, web.localUrl);
  console.log(`[server] web 监听 ${web.host}:${web.port}，配对地址 ${web.publicUrl}`);
  if (!staticDir) console.warn('[server] 未找到手机端页面产物，只提供中继协议');
  const { protocol, hostname } = new URL(web.publicUrl);
  if (protocol === 'http:' && !LOOPBACK.test(hostname)) {
    console.warn(
      '[server] 手机端需要 https：请在反向代理上配置 TLS，并用 --public-url 填 https 地址'
    );
  }
  return relay;
}
