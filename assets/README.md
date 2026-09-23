# assets/ — the icon

One drawing, in the sizes the places that ask for it ask for.

| File | What it is for |
|---|---|
| `icon.svg` | The source. Everything else comes from it |
| `icon-512.png` | Alexa developer console, large icon. Devpost project image |
| `icon-108.png` | Alexa developer console, small icon |
| `icon-render.html` | How the PNGs are made. Not published anywhere |

The demonstration page carries the same drawing inline as its favicon
(`src/web/page.ts`), rather than linking to this folder — a 404 in the console of a
demonstration is a distraction the viewer has to be told to ignore.

## The drawing

The bell on a porter's desk: the object that means *somebody is there*. A horizontal slot across the
dome reads as the hatch a porter slides open, which is the project in one shape.

It replaced an emoji (🛎️) inlined as SVG `<text>`. That worked, but an emoji renders as a different
picture on every platform and several draw it as a grey box at 16 px.

Two sizes constrain the shape, and both are why it looks the way it does:

- **16 px**, where only the silhouette survives — hence one solid shape and a single interior cut.
- **512 px**, where a flat fill looks unfinished unless the geometry is deliberate.

Nothing is thinner than two units at a 64-unit viewBox, and the dome, its base and the button are
one continuous silhouette. The first version left a gap between the dome and the base, which read as
a mistake rather than as a bell resting on a tray.

The colours are the demonstration page's own background and accent, so the tab icon and the page it
opens are visibly the same thing.

## Regenerating the PNGs

No build step and nothing to install. Serve this folder and screenshot the page at the size you
want — the icon fills the viewport, so a screenshot at N×N *is* the icon at N×N.

```bash
cd assets && python -m http.server 8765
# then open http://127.0.0.1:8765/icon-render.html at 512×512 and at 108×108
```

A browser rather than a command-line converter on purpose: ImageMagick's built-in SVG renderer
rounds arcs badly at small sizes, and on Windows `convert` is just as likely to be the operating
system's own FAT-to-NTFS tool, which fails with a message about unit specifications. A browser is
the renderer the icon is designed for anyway.
