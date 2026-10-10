# The twenty-second demo

The GIF that sits after the first paragraph of the README. It shows FirstMate
2.0 doing its job, start to end, with no narration. Make it again whenever the
App, the Index Page or `firstmate setup` changes what it shows.

A GIF, not a video. A GIF plays wherever the README is rendered. An uploaded
video plays on github.com alone, and is blank on npm and on every mirror.

The README names it by its absolute address on `main`, never by a relative
path. npm does not carry `docs/` in the package, and it does not resolve a
relative image, so a relative path shows nothing there:

```md
![Setting FirstMate up, switching Plugins in the App, and adding an Entry from a Shortcut's Popup](https://raw.githubusercontent.com/luanAfons0/FirstMate/main/docs/brand/demo.gif)
```

## What it has to show

Five things, in this order, and nothing else:

1. **`firstmate setup` in a terminal** fetches one Official Plugin, worklog,
   into a `wsl` Place.
2. **The App's window** shows the Index Page: every Plugin and its state, one
   of them Stopped, and the strip says how many are.
3. **The switcher**: a click on the breadcrumb, `wor` typed, and Enter opens
   worklog.
4. **A Plugin Page is a whole page**: worklog at the size of a maximized
   window, with its own header, its box and its four columns.
5. **A Shortcut opens the Popup** over another program. An Entry is typed and
   saved with Shift+Enter, and it is on the worklog page when the window
   comes back.

A short line under each scene says what it shows, and the take ends on the
anchor, the name and `npx @luan-afonso/firstmate desktop`.

## How it is made

It is rendered, not recorded, so that a frame never shows a person's own data
and every take is the same:

- The strip, the switcher and the Index Page are the real pages, written by
  `stripPage` and `switcherPage` (`apps/desktop/src/pages.ts`) and `indexPage`
  (`packages/host/src/index-page.ts`), with the illustrative Plugins `nexus`,
  `research` (Stopped), `scheduler` and `worklog`.
- The worklog page and the Popup are screenshots of a real Host, with a fresh
  clone of worklog filled with demo data through its own tools. Never point it
  at a worklog that holds real data.
- The window is 1400×800, so worklog shows its full layout: below 1100 px it
  folds its board into two columns. The Popup is its real size, 680×540
  (`apps/desktop/src/popup.ts`).
- The fonts are Segoe UI and Consolas, as on Windows.
- The terminal, the window's buttons and the key caps are drawn to match: they
  are not HTML in the product. The terminal follows the words `setup.ts`
  prints, with clack's frame.

A camera zooms in on the part each scene is about, so the text stays readable
at the GIF's width.

## The file

- 800 px wide, the width of the README's column on github.com.
- 12 frames a second and 128 colours: the motion is short UI motion, and a
  still screen costs almost nothing.
- Under 5 MB, so github.com and npm load it quickly. The 2.0 take is 3.7 MB
  and 21.5 seconds.
- It loops, and it is silent.
