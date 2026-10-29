import { LOCAL_IMAGE_SCHEME } from '@shared/localImage';
import { protocol } from 'electron';
import { handleLocalImageRequest } from '../services/localImageProtocol';

/** 必须在 app ready 之前调用（Electron 限制） */
export function registerLocalImageSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_IMAGE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        bypassCSP: true,
        stream: true,
      },
    },
  ]);
}

/** 在 app ready 之后调用 */
export function registerLocalImageProtocolHandler(): void {
  protocol.handle(LOCAL_IMAGE_SCHEME, (request) =>
    handleLocalImageRequest(request.url, request.headers.get('range'))
  );
}
