# Poly Nation Drawings

Standalone drawing tool extracted from the [Poly Nation Cross Pollination Laboratory](https://github.com/heyvian/poly-nation). It takes a 3D model and produces architectural linework drawings: axonometrics, plans, floor plans, elevations and sections, with line weights, clipping planes, SVG export and print/PDF.

Instead of the lab's generated geometry, it **attempts to import Rhino `.3dm` files**. OBJ files and a built-in sample building are also supported.

## Use

Open `index.html` in a browser (no build step), or run `npm install && npm run serve` and visit http://localhost:8080.

1. Click **Open Rhino file…** (or drag a `.3dm` / `.obj` onto the page), or **Load sample**.
2. Pick a view, rendering mode (linework or colour), clipping planes and line weights.
3. **Export SVG** or **Print / PDF**.

## Rhino import (best effort)

Reading uses [rhino3dm.js](https://github.com/mcneel/rhino3dm), loaded from a CDN on first use, so the first `.3dm` import needs internet.

| Content | Result |
| --- | --- |
| Meshes, extrusions | Imported as solids |
| Breps | Imported through their saved render mesh; if none is saved they appear as edges only, with a warning |
| Curves, lines, polylines | Imported as linework |
| Blocks (instances) | Expanded, nested up to 4 levels |
| Hidden layers or objects | Skipped |

Tips: in Rhino, run `Mesh` or `Render` on Breps and save, so render meshes are stored in the file.

- **Layers** become the layers list; untick one to leave it out. "Outlines follow" switches outlines between layers and objects.
- **Units** come from the file's unit system; the header select overrides them. Unset units are assumed metres.
- **Orientation**: Rhino Z is up, and Rhino +Y is drawn as north. The model is centred and its lowest point is the ground.
- **OBJ** files are treated as Z-up like Rhino and use the same unit select.
- **Storey height** (default 3.5 m) sets floor plan levels.

## Layout

```
index.html
src/css/    base, layout, drawing, print
src/js/     util, drawing-core, drawing-render, model-import, drawing-ui, app
tests/      importer (node) and smoke (Edge via playwright-core) tests
tools/      Illustrator script to turn exported SVG into layers
```

## Tests

```
npm install
npm test
```
