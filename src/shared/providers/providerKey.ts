import { createHash } from 'node:crypto';

/** Main 与 worker 共用注册身份，不能用 settings UUID 或仅 modelId 替代。 */
export function providerKeyFor(model: { api: string; baseUrl: string; apiKey: string }): string {
  const keyFp = createHash('sha256').update(model.apiKey).digest('hex').slice(0, 8);
  const host = createHash('sha256')
    .update(`${model.api}\0${model.baseUrl}`)
    .digest('hex')
    .slice(0, 12);
  return `enso-${host}-${keyFp}`;
}
