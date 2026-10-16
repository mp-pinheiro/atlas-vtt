import { SEAT_PATH } from '../../src/app/online/protocol/relay.ts';
import { noContent } from './http/responses.ts';
import { route } from './http/router.ts';

export { HostRegistry } from './registry/HostRegistry.ts';
export { TableObject } from './table/TableObject.ts';

const API_PREFIX = '/api/';

/**
 * The Atlas relay. The assets layer answers the player client's files before this runs (only
 * `/api/*` and the seat path run the Worker first); a path that matches no file comes here and is
 * left to the assets layer's own answer.
 */
export default {
  fetch(request: Request, env: Cloudflare.Env): Response | Promise<Response> {
    const { pathname } = new URL(request.url);
    // A browser without the page's service worker asks here: answered without reading the request.
    if (pathname === SEAT_PATH) return noContent();
    if (pathname.startsWith(API_PREFIX)) return route(request, env);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
