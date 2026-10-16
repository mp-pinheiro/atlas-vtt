import { SEAT_PATH } from '../../src/app/online/protocol/relay.ts';
import { noContent } from './http/responses.ts';
import { route } from './http/router.ts';

export { HostRegistry } from './registry/HostRegistry.ts';
export { TableObject } from './table/TableObject.ts';

const API_PREFIX = '/api/';

/**
 * The Atlas relay. Only `/api/*` and the seat path run the Worker first (`run_worker_first`); for
 * every other path Cloudflare routes assets first, serves the player client's file when one matches
 * and otherwise runs the Worker. A path that matches no file therefore comes here too, and is handed
 * back to the assets layer, whose answer for it is 404 (`not_found_handling` is not set).
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
