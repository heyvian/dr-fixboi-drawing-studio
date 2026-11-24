# Dr. FixBoi®’s Drawing Studio

Drawing Studio turns Rhino `.3dm` and OBJ models into architectural linework for plans, sections, elevations and axonometrics. Set printed line weights, clip the model, and export editable SVG or vector PDF sheets.

The Optics Building uses the supplied `val.obj` shell as a starting point, with 28 illustrative levels and populated design studios. Furniture, students, desktop clutter and recycling can be shown or hidden independently when drawing plans and sections.

## Use

Run `npm ci && npm run serve` and visit http://localhost:8080. The app has no build step. Opening `index.html` directly also works in browsers that allow local files.

1. Choose **Open model…** or **Load sample** in the **File** menu. You can also drag a `.3dm` or `.obj` file onto the page.
2. The model opens in **3D navigate**: drag to orbit, right-drag or Shift-drag to pan, wheel to zoom to the cursor, **Zoom extents** (or Home) to fit everything, and the Axo, Elevation and Plan buttons with their direction compass for standard views. Double-click a point (or use **Set orbit centre** and click) to make it the orbit centre, marked by a red crosshair: orbiting turns around it and the standard-view buttons centre on it, keeping your zoom. **Zoom extents** resets the centre to the middle of the model. The 3D view is orthographic, so it matches the drawing projection.
3. Choose **Draw this view** (or the **Drawing Sheet** tab) to capture the 3D view. Use the buttons above the sheet to switch between Captured view, Axonometric, Plan, and Elevation. Drag the sheet or use the arrow keys to pan it independently of the 3D camera. Use the compass to set the drawing’s direction. A selected clipping plane also provides its own projection.
4. **Recapture 3D view** in the View box takes a fresh reference from the 3D camera and resets sheet panning. Use the **Clipping planes** menu to add or adjust a cut, then choose **Align view to plane** to draw straight onto it. Open **Line weights** in the sheet toolbar. **Fit** centres the geometry that remains after clipping and picks a scale for the current paper.
5. Choose Letter, Tabloid, A4, A3 or A2, and fill in the sheet title, number and revision.
6. Save a named view to recall its framing, visible layers, clipping planes, pens and sheet setup.
7. Use **Export SVG** for Illustrator, **PDF for Bluebeam** to download the current sheet as a vector PDF, or **Print / PDF** to open the browser’s print dialog. In Plan, **Print floor set** in the View box prints one sheet per floor at a shared scale.

Choose **Auto fit** or a fixed drawing scale from 1:1 to 1:5000. Changing the scale keeps whatever is at the centre of the sheet in place. The working sheet, named views and export preferences are stored in the current browser. Reopen the same model to continue. Your model file stays on your device.

Use **Paper size → Custom size…** to save a named sheet in millimetres or inches. Custom sizes are available across models in the same browser and can be recalled with a saved view.

To draw a perspective cut, add a vertical or horizontal clipping plane and choose **Align view to plane**. Under **View**, choose **Section perspective** for a vertical cut or **Plan perspective** for a horizontal one. The cut keeps its printed scale and line weights. The 8–200 mm lens and **Lighten beyond cut** control the geometry that recedes behind it. Enable **Solid black cut fill** to fill closed cut contours on the aligned plane, leaving holes clear. The projection, lens, fade, and cut fill are saved with the view and carried through SVG, PDF, and print.

In **Line weights**, camera-distance assignment shows which depths each pen covers. Pen widths are set in printed millimetres. A 0.50 mm stroke stays 0.50 mm when you change the drawing scale. For `.3dm` files, **Rhino Print Width by layer** reads the Print Width column from the Layers panel, uses 0.25 mm for layers set to Default, and omits layers set to No print from the sheet. The overall silhouette, key outlines and ground line have their own printed widths and colours. Ground lines appear in elevations and vertical sections.

### Illustrator

The exported SVG contains editable vector artwork, organized by pen weight and treatment with a separate section-cut layer when present. It uses the chosen paper dimensions and physical point coordinates, so strokes retain their on-sheet weight when opened at the exported size. Artwork is trimmed to the sheet or floor bounds before export. Titles, floor captions and scale labels are vector outlines, so Illustrator needs no matching installed font. The bundled outline font covers Latin, Greek, Cyrillic and common drawing symbols.

Click **Export SVG** to choose whether to include the paper and annotations and whether strokes should be grouped or individually selectable. Grouped strokes produce a lighter document for complex models. Click **Export** in the dialog to download the SVG. Drawing Studio remembers these options in the current browser. The dialog also has the Illustrator layer script and five steps for turning the SVG into a named-layer AI file.

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
- **Units** start at **From file** each time you open a model. The File menu shows the units in use and can override them for the current file. Rhino imports read model-space units. OBJ files and Rhino files without recognised units default to metres.
- **Orientation**: Rhino Z is up, and Rhino +Y is drawn as north. The model is centred and its lowest point is the ground.
- **OBJ** files are treated as Z-up like Rhino.
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
- [jsPDF](https://github.com/parallax/jsPDF) and [svg2pdf.js](https://github.com/yWorks/svg2pdf.js) produce the vector PDF. See the [jsPDF licence](src/vendor/jspdf-LICENSE.txt) and [svg2pdf.js licence](src/vendor/svg2pdf-LICENSE.txt).
- [Playwright](https://playwright.dev/) runs the end-to-end tests in [Chromium](https://www.chromium.org/). [Node.js](https://nodejs.org/) runs the development server and importer tests.
