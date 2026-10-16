# Privacy and network use

Atlas VTT works offline. Maps, tokens, notes, audio and settings stay in your vault. Atlas connects to the internet only when you choose to: to host online play, to submit an issue report, or to load an image from a web address.

- No telemetry, no analytics, no ads.
- Hosting and joining online play require no Atlas account. Hosts need a key for their configured relay.
- The Obsidian plugin does not download executable code or update itself. The browser player runs the client code served by the configured relay.

## Network access

If you set a token or map background to an `http://` or `https://` image URL, or copy an image that a note embeds from an external URL, that image is downloaded from the address in question. Images stored in your vault cause no network traffic.

## Online play (self-hosted beta)

Online play lets you host a table that your players join from their web browsers. It is off until you turn on **Online play** in the command palette's **Experimental features** page. While it is off, Atlas makes no connection for it.

Hosting uses a key supplied for your configured relay, without an Atlas sign-in. The key is kept only in Obsidian secure storage on this device; it is never written to plugin data or synced files. The default relay is `https://atlas.fairfruit.tv`. Changing the relay origin ends the current table and clears its saved connection. Removing the host key also stops the table and forgets its saved connection.

Before a table starts, Atlas may check the configured relay with an authenticated `GET /api/me` when a host key is saved or revalidated. The request checks the key and available seats; it sends no game content. With no saved host key, enabling Online play makes no relay request. Starting a table or submitting a player join opens the live table connection. While a table runs, Atlas connects to the configured relay over an encrypted WebSocket or a player's HTTPS event stream. Traffic includes the permitted scene's map and token images, fog, lighting, native sheets, movement paths, dice, chat and table interactions. The relay can read traffic while routing it, but does not retain game messages, assets, sheets or explored masks. It stores credential hashes, connected and waiting player names, and lifecycle records. Disconnected names are removed when no connection or pending admission needs them; reconnect credential hashes remain until the table ends. A table expires 24 hours after the GM disconnects.

Personal vision filters new token, sight, origin and asset disclosures per recipient. The browser still receives the map image and wall/light geometry; a modified browser can inspect downloaded map art and keep assets it already received. Remote sheets contain bounded JSON and asset references. Imported script source, vault paths and active HTML are not sent for execution in the browser.

The browser keeps its player identity, content-addressed asset cache and personal explored memory locally. Personal memory is keyed separately for each table, player, map identity and map dimensions and is never uploaded. Leave and forget removes that table's local identity and personal memory; it keeps the shared asset cache and does not revoke the relay credential or change the GM's character ownership.

Error reports are off by default and, when enabled, are sent to the configured relay. Feedback is unavailable until enabled in settings. This relay's report and feedback endpoints discard submissions; they do not file issues or retain submissions. The unrelated offline issue-report command uses the reporting service described below.

On the GM's device, the running table, its log, ownership, scene permissions and player books are kept in `atlas-vtt/.atlas-data/online.json`, a device-local folder excluded by the supported vault sync tools. The host key stays in secure storage.

## Files outside the vault

Atlas VTT reads files outside your vault only when you choose them for import. Random-table imports read selected PDF, XLSX, CSV, TSV, Markdown and text files on your device and create Markdown notes inside your vault. The source files are not changed or uploaded. Atlas does not scan other files on your device.

PDF imports use Obsidian's bundled PDF reader. XLSX imports read XML parts locally; the Open XML namespace identifiers in those parts are format names, not network requests.

## Code execution

When the optional [Fantasy Statblocks](https://github.com/javalent/fantasy-statblocks) plugin is installed, Atlas VTT renders creature statblocks with that plugin's layouts. Layouts can contain small JavaScript callbacks (for example to format a modifier). Atlas VTT runs those callbacks exactly as Fantasy Statblocks does. They come only from Fantasy Statblocks' own layout data on your computer — never from note content or the internet. That includes layouts you imported from someone else, so only import layouts you trust, as you would for Fantasy Statblocks itself. Without Fantasy Statblocks installed, no such code runs.

Atlas VTT converts imported images in background workers so Obsidian stays responsive. The workers run code bundled in the plugin's `main.js`, started from a local blob URL; nothing is downloaded, and they only receive the images you import.

## Issue reports

The **Report an issue** command and **Settings → Atlas VTT → Help and feedback**
open a form inside Obsidian. **Submit report** sends the filled report over HTTPS
to the Atlas reporting service. The service
publishes it as a public GitHub issue and returns a confirmation. No GitHub
account is required. Nothing is sent merely by opening the form.

The report includes the text you enter and the Atlas, Obsidian and Electron
versions, operating system, interface language and active theme. Community
plugin names/versions and recent Atlas errors are optional. Automated diagnostics
exclude vault names, file paths, note contents and map data; your own report
text is published as entered.

The online player's report form, if available, submits to the configured relay. The relay discards the submission; it does not publish an issue or retain the report. Nothing is sent merely by opening the form.

The reporting service processes your IP address for abuse prevention. It stores
a daily keyed address hash for up to 24 hours, not the raw IP. It retains request
identifiers, report hashes and issue receipts to prevent duplicate submissions;
it does not retain report bodies separately from GitHub. **Copy report** writes
the report to your clipboard without sending it. See
[docs/reporting-issues.md](docs/reporting-issues.md).

## Clipboard and local storage

The clipboard is written only when you choose a copy action (for example "Copy image"). Interface state such as the music queue is kept in local storage on your device.
