# Dr. FixBoi®’s Drawing Studio

Standalone drawing tool extracted from the [Poly Nation Cross Pollination Laboratory](https://github.com/heyvian/poly-nation). It takes a 3D model and produces architectural linework drawings: axonometrics, plans, floor plans, elevations and sections, with line weights, clipping planes, SVG export and print/PDF.

Instead of the lab's generated geometry, it **attempts to import Rhino `.3dm` files**. OBJ files and a built-in sample building are also supported.

## Use

Run `npm ci && npm run serve` and visit http://localhost:8080. The app has no build step. Opening `index.html` directly also works in browsers that allow local files.

1. Click **Open Rhino file…** (or drag a `.3dm` / `.obj` onto the page), or **Load sample**.
2. The model opens in **3D navigate**: drag to orbit, right-drag or Shift-drag to pan, wheel to zoom to the cursor, **Zoom extents** (or Home) to fit everything, and the Axo/Plan/N/E/S/W buttons for standard views. Double-click a point (or use **Set orbit centre** and click) to make it the orbit centre, marked by a red crosshair: orbiting turns around it and the standard-view buttons centre on it, keeping your zoom. **Zoom extents** resets the centre to the middle of the model. The 3D view is orthographic, so it matches the drawing projection.
3. Choose **Draw this view** (or the **Drawing Sheet** tab) to capture the 3D view. Use the buttons above the sheet to switch between Captured view, Axonometric, Plan, and Elevation. These projections use the captured orbit direction and target. Drag the sheet or use the arrow keys to pan it independently of the 3D camera. A selected clipping plane also provides its own projection.
4. **Recapture 3D view** takes a fresh reference from the 3D camera and resets sheet panning. Set the rendering mode, clipping planes and line weights in the drawing controls.
5. Choose Letter, Tabloid, A4, A3 or A2, and fill in the sheet title, number and revision.
6. Save a named view to recall its framing, visible layers, clipping planes, pens and sheet setup.
7. **Export SVG** or **Print / PDF**.

Changing the drawing scale keeps whatever is at the centre of the sheet in place. The working sheet, named views and export preferences are stored in the current browser. Reopen the same model to continue. Your model file stays on your device.

### Illustrator

The exported SVG contains editable vector artwork, organized by pen weight and treatment with a separate section-cut layer when present. Artwork is trimmed to the sheet or floor bounds before export. Titles, floor captions and scale labels are vector outlines, so Illustrator needs no matching installed font. The bundled outline font covers Latin, Greek, Cyrillic and common drawing symbols. Open **SVG and Illustrator** in the sidebar to remove the background or annotations, or to export individually selectable strokes. Grouped strokes produce a lighter document for complex models. To turn the SVG groups into native Illustrator layers, download the JSX script from the same panel, use **File → Scripts → Other Script** in Illustrator, and select the exported SVG. The script then prompts you to save a native AI file.

## Rhino import (best effort)

Reading uses the installed [rhino3dm.js](https://github.com/mcneel/rhino3dm) library when served by `npm run serve`. The standalone HTML falls back to a CDN, which needs internet on the first `.3dm` import.

| Content | Result |
| --- | --- |
| Meshes, extrusions | Imported as solids |
| Breps | Imported through their saved render mesh; if none is saved they appear as edges only, with a warning |
| Curves, lines, polylines | Imported as linework |
| Blocks (instances) | Expanded with member layers and colour inheritance (up to 32 levels) |
| Hidden layers or objects | Skipped |

Tips: in Rhino, run `Mesh` or `Render` on Breps and save, so render meshes are stored in the file.

- **Flat rendering** uses the Rhino display colours directly for the visible surface fills. Hybrid uses the same colours with a lighter shaded treatment. The importer uses layer colours, explicit object colours, material diffuse colours and parent block colours where available.
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
npm ci
npm test
```

The default browser smoke test uses Microsoft Edge. With Chromium and the development server running, use `APP_URL=http://127.0.0.1:8080 BROWSER_EXECUTABLE=/usr/bin/chromium npm test` to also exercise browser-based Rhino import.

## Open-source credits

- [rhino3dm](https://github.com/mcneel/rhino3dm) and [openNURBS](https://github.com/mcneel/opennurbs) provide the browser and Node readers for Rhino geometry, layers, colours, and block data.
- [OpenType.js](https://opentype.js.org/) converts SVG labels into outlines from the bundled [DejaVu Sans](https://dejavu-fonts.github.io/) subset. See the [OpenType.js licence](src/vendor/opentype-LICENSE.txt) and [DejaVu licence](src/vendor/DejaVu-LICENSE.txt). [FontTools](https://fonttools.readthedocs.io/) generated the subset.
- [Playwright](https://playwright.dev/) runs the end-to-end tests in [Chromium](https://www.chromium.org/). [Node.js](https://nodejs.org/) runs the development server and importer tests.
