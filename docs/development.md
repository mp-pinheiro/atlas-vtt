# Development and pull requests

Atlas keeps upstream's `main` and `beta` release lines and this fork's `work` beta line:

| Branch | Channel | Version format | Who gets it |
| --- | --- | --- | --- |
| `beta` | Beta builds for QA | `x.y.z-beta.N` | Maintainer and contributors through [BRAT](beta-testing.md) |
| `main` | Stable releases | `x.y.z` | Everyone through the Obsidian community directory |
| `work` | Fork beta development and online player deployment | `x.y.z-beta.N` | Fork testers and the hosted browser player |

For upstream changes, create a branch from `beta` and open a pull request against `beta`; only promotion pull requests target `main`. This fork's player-agency changes target `work`.

CI enforces the channel: a pull request or push to `main` fails if the manifest version has a beta suffix, and one to `beta` or `work` fails if it does not. Obsidian's community directory reads `manifest.json` from `main` and installs the release tagged with that version, and GitHub never marks a pre-release as *latest*, so beta builds are unreachable from production installs. The existing beta-release workflow still publishes only from `beta`; `work` does not publish plugin releases.

## Local checks

```sh
npm ci
npx tsc --noEmit
npm run lint
npx vitest run
npm run build:ci
npm run preflight
npm run release:prepare
```

`build:ci` builds without copying files into a local vault. CI runs these checks
and every one of them blocks the merge, lint included.

### Browser player and relay

Install `just` and `fnm` first. `just setup` installs the Node version in `.nvmrc` and the root dependencies. `just smoke` builds the browser client and starts a real local GM table with its relay, using temporary local relay storage. To install the Obsidian plugin in a real test vault, run `just obsidian /path/to/test-vault`; it refuses a vault without `.obsidian` and copies only to that vault. Local plugin hosting uses `http://127.0.0.1:8787` and the development-only key `atlas-vtt-local-test-host-key`. These recipes never point at production.

```sh
just setup
just smoke
just obsidian /path/to/test-vault
```
```sh
npx vitest run --project player player/tests/conformance.test.ts
```

Player CI runs on pull requests and pushes to `work`, alongside Plugin CI. It checks plugin/player/relay types, dependency boundaries, player state/transport/fake-table tests, the real Workers-runtime relay suite, plugin/protocol/GM agency tests, the browser build and local relay conformance without deployment secrets. CI sets `SOURCE_REVISION` to its checked-out SHA and `SOURCE_URL` to the full corresponding commit tree in its own repository; the browser's About/Source link must identify that source, not upstream.

Rendering and privacy acceptance remain required on a GPU-equipped workstation: install Chromium with `npx playwright install chromium`, run `npm run test:player:browser`, then `npm run test:gpu -- sightMask fallbackPicture mapImageSeams mapImageViews unlitGrid`, and perform the real two-player browser smoke with screenshots of the distinct personal pictures and GM approval queue. Hosted CPU checks do not establish pixel privacy, GPU fallback correctness or observed browser interactions, and a successful hosted deploy is not proof of those checks.

### Combined player deployment

The Deploy Player workflow runs only on pushes to `work`, checks out the exact push SHA and repeats the Player CI gates before deploying the static client and relay together with Wrangler 4.151.1. It uses the `production` environment, read-only repository contents permission and the serialized `atlas-player-production` concurrency group. Production is `https://atlas.fairfruit.tv`; the Worker configuration owns that custom-domain route, not the local development command.

The production GitHub environment is configured with `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `HOST_KEY`. The deploy workflow writes `HOST_KEY` to a temporary mode-0600 file and uploads it as a Worker secret with `--secrets-file`. Never put the host key in Wrangler `vars`, tracked files, browser build variables or CI command arguments; never copy a local OAuth session into CI. The fixed key in `dev:relay` is local-test-only and is never passed to deployment.

A green workflow alone does not verify production: confirm the deployed client loads, authenticated `/api/me` reports twelve seats, and a real Obsidian-hosted table admits two browser players over the production custom domain. Publication authority, production secrets and this end-to-end proof are separate prerequisites; local implementation and checks do not imply they are satisfied.

### Lint

`npm run lint` runs `eslint-plugin-obsidianmd`, the rule set Obsidian's community
directory scores the plugin with, so a lint finding is a public review finding.
The gate is zero tolerance: no errors, no warnings (`--max-warnings 0`).

- Fix a finding where it starts, usually a declaration typed `any`. Do not run
  `eslint --fix` across the tree.
- Inline `eslint-disable` comments are switched off (`noInlineConfig`) and fail
  the gate. `@ts-ignore`, `@ts-expect-error` and `@ts-nocheck` are errors
  (`ban-ts-comment`).
- The one accepted exception, the `Function` constructor that runs Fantasy
  Statblocks layout callbacks (see [PRIVACY.md](../PRIVACY.md)), is recorded in
  `eslint.suppressions.json`. A suppression covers a rule, in a file, up to a
  count, so a second occurrence anywhere still fails. Adding an entry is a
  maintainer decision and needs its reason in the pull request. Obsidian's
  scorecard does not read this file and keeps listing suppressed findings.
- When a suppressed finding is fixed, ESLint fails until the stale entry is
  removed: `npx eslint . --suppressions-location eslint.suppressions.json --prune-suppressions`.
  The file deliberately does not use ESLint's default name: Obsidian's
  directory review runs ESLint with its own rule set, and a suppression that
  set does not use makes ESLint exit with code 2, which the review reports as
  a fatal error.

### Workflow conventions

Actions are pinned to a full commit SHA with the version in a trailing comment;
Dependabot (`.github/dependabot.yml`) opens weekly pull requests against `beta`
that move the pins and group minor and patch npm updates. Checkouts do not
persist credentials, workflows declare the minimum `permissions`, and the Node
version comes from `.nvmrc`. Pull requests also run a dependency review that
fails on a newly added dependency with a known vulnerability of moderate
severity or higher.

## Test builds

Successful Plugin CI runs attach an `atlas-vtt-<commit>` artifact containing
`main.js`, `manifest.json` and `styles.css`, retained for 14 days. For pull
requests, `<commit>` is the PR head commit, but the build itself is that commit
merged into the current base branch, so it may include base changes that are not
in the branch. Install these files in an isolated test vault's
`.obsidian/plugins/atlas-vtt/` directory and reload the plugin. Include practical
Obsidian test steps for interaction changes. These artifacts do not publish a
release or bump the version.

## Beta builds

Every push to `beta` runs **Publish Beta Build**. When the manifest carries a
beta version that has not been published yet, the workflow runs the full check
suite, attests build provenance and publishes a GitHub **pre-release** tagged
with that version, with `changelog/Unreleased.md` as its notes. Pushes that do
not bump the version publish nothing and the run stays green. A push that sets
the version to one already tagged on another commit fails the run, as does a
manual run for such a version.

To cut a new beta after merging into `beta`:

```sh
git checkout beta && git pull
npm version prerelease --preid beta   # 0.2.0-beta.1 -> 0.2.0-beta.2
git push --follow-tags
```

To start the beta cycle for a new target version use
`npm version preminor --preid beta` (or `prepatch` / `premajor`). Testers
install and update through BRAT as described in [beta-testing.md](beta-testing.md).

## Promoting a beta to a stable release

1. Branch from `beta`: `git checkout -b release/0.2.0 beta`.
2. Move the pending notes from `changelog/Unreleased.md` into
   `changelog/0.2.0.md`, run `npm run changelog:generate` and commit.
3. `npm version 0.2.0` (this also updates `versions.json`) and push the branch.
4. Open a pull request against `main`. CI verifies the stable version.
5. After merging, run **Prepare Plugin Release** on `main`, review the draft and
   publish it. See [releasing-obsidian-plugin.md](releasing-obsidian-plugin.md).
6. Merge `main` back into `beta` and start the next beta cycle with
   `npm version preminor --preid beta`.

## Review and merge

Pull requests require a green `build-plugin` check and an up-to-date branch;
`main` additionally requires the `atlas/pr-review` check. Automated review is
provided by a private maintainer-managed service. Drafts are not automatically
reviewed; external contributions require manual maintainer review. If the review
status reports an error, contact the maintainer rather than bypassing or
weakening CI.

The maintainer decides which fixes to implement, when to merge, and when to
publish a release. Stable releases continue through the Prepare Plugin Release
workflow, which refuses beta versions and commits that are not on `main`.
