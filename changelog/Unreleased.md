## Added
- Online play: a browser player and self-hosted Cloudflare relay, with a host key stored in Obsidian secure storage instead of an Atlas account.
- Online player actions: character requests, player colours, indexed native-sheet rolls, permitted conditions, initiative rolls and End turn, approved movement paths, nearby doors and recipient-specific vision with browser-local explored memory.

## Improved
- Browser player: open on the map, close panels back to it, and use compact dice, character controls in the book, bounded readers and the Atlas VTT theme's parchment and candlelight appearances.
- Browser player: the Dice panel is Atlas' own dice tray (tap the dice, set a modifier, throw), with a free formula beside it. The theme's Fantaisie Artistique headings, Libron body text, double rules and ivy drawings now reach panels, dialogs and the join page.
- Online play: busy tables send far fewer messages. Cursors, lasers and measurements go out ten times a second and still move smoothly, and a changed quest or world map reaches players without their whole book being sent again.
- Random tables: rename a table or remove it from the list from its menu (⋯ or right-click) in the Random tables window, and undo a removal from the message that follows. A new name shows only in Atlas and leaves the note as it is; you can also set it in the collection settings. A table whose note was deleted can now be removed too.

## Fixed
- Browser player: keep keyboard input in form controls, roll menus and readers instead of moving the selected token.
- Browser player: a roll the GM's table refuses now says so and why, next to where rolls land, and on phones the dice land over the open Dice panel instead of out of sight.
- Online player view: clear grid masks before destroying their graphics so scene changes keep pointer input working.
- Online books: keep the image-list dependency stable so opening a found note cannot enter a render loop.
- Initiative changes now participate in the scene's normal undo and redo history.
- Online play: players keep control of their characters when you change scenes. Giving a token to a player gives them the character it was placed from, so every token of that character is theirs on every scene.
- Statblocks from TTRPG Convert CLI import as tokens with their image. Atlas now reads image paths with encoded spaces, such as `/2.%20Mechanics/token.png`.
