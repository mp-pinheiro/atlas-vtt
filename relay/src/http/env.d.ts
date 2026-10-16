/**
 * The Worker's bindings, as `wrangler.jsonc` declares them. `HOST_KEY` is a Worker secret that a
 * person sets by hand (`npx wrangler secret put HOST_KEY`); it is not in the configuration, and
 * without it the relay creates no tables.
 */
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import('../index.ts');
    durableNamespaces: 'TableObject' | 'HostRegistry';
  }
  interface Env {
    readonly TABLES: DurableObjectNamespace<import('../table/TableObject.ts').TableObject>;
    readonly HOSTS: DurableObjectNamespace<import('../registry/HostRegistry.ts').HostRegistry>;
    readonly ASSETS: Fetcher;
    readonly HOST_KEY?: string;
  }
}
