# Poly Nation Drawings

Standalone drawing tool extracted from the [Poly Nation Cross Pollination Laboratory](https://github.com/heyvian/poly-nation). It takes a 3D model and produces architectural linework drawings: axonometrics, plans, floor plans, elevations and sections, with line weights, clipping planes, SVG export and print/PDF.

Instead of the lab's generated geometry, it **attempts to import Rhino `.3dm` files**. OBJ files and a built-in sample building are also supported.

## Use

Open `index.html` in a browser (no build step), or run `npm install && npm run serve` and visit http://localhost:8080.

1. Click **Open Rhino file…** (or drag a `.3dm` / `.obj` onto the page), or **Load sample**.
2. The model opens in **3D navigate**: drag to orbit, right-drag or Shift-drag to pan, wheel to zoom to the cursor, **Zoom extents** (or Home) to fit everything, and the Axo/Plan/N/E/S/W buttons for standard views. Double-click a point (or use **Set orbit centre** and click) to make it the orbit centre, marked by a red crosshair: orbiting turns around it and the standard-view buttons centre on it, keeping your zoom. **Zoom extents** resets the centre to the middle of the model. The 3D view is orthographic, so it matches the drawing projection.
3. Choose **Draw this view** (or the **Drawing** tab). The drawing opens framed on exactly what you saw, with its view set to **From 3D view**. Moving, scaling or nudging the sheet never changes the 3D view, and going back to 3D keeps its own camera.
4. In Drawing, **Use 3D view** re-takes the current 3D camera as the base (resetting any sheet nudging). Pick a view, rendering mode, clipping planes and line weights.
5. **Export SVG** or **Print / PDF**.

Changing the drawing scale keeps whatever is at the centre of the sheet in place.

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
src/js/     util, drawing-core, drawing-render, model-import, navigate, drawing-ui, app
tests/      importer (node) and smoke (Edge via playwright-core) tests
tools/      Illustrator script to turn exported SVG into layers
```

## Tests

```
npm install
npm test
```
