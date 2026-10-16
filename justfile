set shell := ["bash", "-eu", "-o", "pipefail", "-c"]
set positional-arguments
set default-list

[doc('Install the Node version in .nvmrc and repository dependencies')]
setup:
    fnm install
    fnm exec --using=.nvmrc npm ci

[doc('Build the player and start an isolated GM/player fixture; Ctrl+C stops it')]
smoke: build-player
    fnm exec --using=.nvmrc node player/scripts/smoke.mjs

[doc('Build the Obsidian plugin without copying it into any vault')]
build-plugin:
    fnm exec --using=.nvmrc node_modules/.bin/vite build --config vite.config.mts

[doc('Build the browser client served by the local relay')]
build-player:
    fnm exec --using=.nvmrc npm run build:player

[doc('Build and copy the plugin only into the specified existing test vault')]
install vault:
    test -d "$1/.obsidian"
    just build-plugin
    fnm exec --using=.nvmrc node scripts/copy-plugin.js "$1"

[doc('Build the browser client and run the development relay on localhost:8787')]
relay: build-player
    fnm exec --using=.nvmrc npm run dev:relay

[doc('Install into a test vault and start the local relay for real Obsidian hosting')]
obsidian vault: (install vault) build-player
    @printf '%s\n' 'Reload Atlas in the test vault and enable Online play.' 'Relay origin: http://127.0.0.1:8787' 'Development host key: atlas-vtt-local-test-host-key' 'Use separate browser profiles for Alice and Bob. Ctrl+C stops the relay.'
    fnm exec --using=.nvmrc npm run dev:relay
