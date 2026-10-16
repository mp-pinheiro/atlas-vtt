import type { Env as RelayEnv } from '../src/index.ts';

declare global {
  namespace Cloudflare {
    interface Env extends RelayEnv {}
  }
}
