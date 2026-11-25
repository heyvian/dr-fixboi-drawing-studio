# Dr. FixBoi®’s Drawing Studio

Drawing Studio turns Rhino `.3dm` and OBJ models into architectural linework for plans, sections, elevations and axonometrics. Set printed line weights, clip the model, and export editable SVG or vector PDF sheets.

The Optics Building uses the supplied `val.obj` shell as a starting point, with 28 illustrative levels and populated design studios. Furniture, students, desktop clutter and recycling can be shown or hidden independently when drawing plans and sections.

## Use

Run `npm ci && npm run serve` and visit http://localhost:8080. The app has no build step. Opening `index.html` directly also works in browsers that allow local files.

1. Choose **Open model…** or **Load sample** in the **File** menu. You can also drag a `.3dm` or `.obj` file onto the page.
2. The model opens in **3D navigate**: drag to orbit, right-drag or Shift-drag to pan, wheel to zoom to the cursor, **Zoom extents** (or Home) to fit everything, and the Axo, Elevation and Plan buttons with their direction compass for standard views. Double-click a point (or use **Set orbit centre** and click) to make it the orbit centre, marked by a red crosshair: orbiting turns around it and the standard-view buttons centre on it, keeping your zoom. **Zoom extents** resets the centre to the middle of the model. The 3D view is orthographic, so it matches the drawing projection.
3. Switch between **3D Model** and **Drawing Sheet** to work in each space. **Capture to sheet** takes a new reference from the 3D camera and resets sheet panning. The sheet toolbar switches between Axonometric, Plan, Elevation, Cut and Captured. Drag the sheet or use the arrow keys to pan. **View** in the properties panel contains the compass and perspective settings.
4. Open **Cuts** to add or adjust a clipping plane. Choose **Align view to plane** to look straight onto it. **Fit** centres the remaining geometry and picks a scale. Open **Pens** for print weights, pen colours, depth bands, and layer-based weights.
5. Set the paper size, orientation, title, sheet number and revision in **Paper**. Open **Check sheet contrast** to check visible ink against the paper and apply suggested colour or perspective fade adjustments. Review any shading against the ink visually.
6. In the **Project browser**, choose **Save as…** to create a named sheet view with its framing, visible layers, clipping planes, pens and sheet setup. Select a view and choose **Open view**, double-click it or press Enter on the row. **Update** replaces its saved settings, and **Rename** changes its name. **Delete** asks for confirmation.
7. Use **Export SVG** for Illustrator, **PDF for Bluebeam** to download the current sheet as a vector PDF, or **Print / PDF** to print the same vector artwork. In Plan, **Paper → Print floor set** prints one vector sheet per floor at a shared scale. Choose **Actual size** or **100%** in the print dialog to keep that scale.

Choose **Expand sheet** to inspect the current sheet in a full-window viewer. Zoom and scroll independently of the sheet’s print scale and placement. With the preview area focused, use **+** and **−** to zoom, **0** to fit, and **Escape** to close.

**File → Save project…** downloads a `.fixboi` file with the source model, current sheet, saved views, referenced custom paper sizes, camera, model units, and export options. **File → Open project…** opens that saved copy, including in another browser. You can also drop a project onto the studio. Projects made with the sample use the built-in building. Each save downloads a new copy.

On phones, open models or projects, switch projections, and browse saved sheet views. Use a larger screen with a mouse and keyboard for drawing setup and export. The inspector tabs support arrow keys, Home and End. **Skip to viewport** appears at the start of the keyboard tab order after loading a model.

Choose **Auto fit** or a fixed drawing scale from 1:1 to 1:5000. Changing the scale keeps whatever is at the centre of the sheet in place. The working sheet, named views and export preferences are stored in the current browser. Reopen the same model to continue. Your model file stays on your device.

Use **Paper size → Custom size…** to save a named sheet in millimetres or inches. Custom sizes are available across models in the same browser and can be recalled with a saved view.

To draw a perspective cut, add a vertical or horizontal clipping plane under **Cuts** and choose **Align view to plane**. In the projection control below **Align view to plane**, choose **Section perspective** for a vertical cut or **Plan perspective** for a horizontal one. The cut keeps its printed scale and line weights. The 8–200 mm lens and **Lighten beyond cut** control the geometry that recedes behind it.

**Perspective origin** defaults to the exact sheet centre. Choose **Pick on sheet** and click where you want the vanishing point. You can also move the crosshair with the arrow keys and press Enter. **Sheet centre** resets the point. The point stays in place when you pan the drawing on the paper. Choose **3D camera** and **Use current 3D camera** to take the perspective eye from the current model framing and lens. If that eye is behind the cut, the drawing uses the sheet point and shows a message. Both origin modes are saved with views and projects.

**Cuts → Cut solids** starts with **Solid fill** for the cut faces of a plan or section viewed straight on, including a perspective cut. You can switch to **Diagonal hatch**, **Crosshatch**, or **None**. The colour applies to the fill or hatch. Hatch spacing is measured in printed millimetres and holds across drawing scales. Openings stay clear. The hatch strokes and their paper-coloured backing export as separate layers, so you can edit either in Illustrator. Cut and lens settings are saved with the view and carried through SVG, PDF, and print.

In **Pens**, choose **Camera distance** to assign pen widths from nearest to farthest. Each boundary marks where one pen gives way to the next. Drag its slider or enter a percentage. For example, a 50% boundary between Pen 1 and Pen 2 gives Pen 1 the nearest half of the visible depth. **Space evenly** resets the boundaries. Pen widths are set in printed millimetres. A 0.50 mm stroke stays 0.50 mm when you change the drawing scale. For `.3dm` files, **Rhino Print Width by layer** reads the Print Width column from the Layers panel, uses 0.25 mm for layers set to Default, and omits layers set to No print from the sheet. The overall silhouette, key outlines and ground line have their own printed widths and colours. Ground lines appear in elevations and vertical sections.

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
- **Model layers** shows each imported colour beside an editable current swatch. Colour changes affect geometry set to inherit its layer’s colour in the 3D preview, Hybrid and Flat sheets, and their exports. **Reset colour** returns a layer to its imported colour. Working sheets and named views remember the overrides. Untick a layer to leave it out, or use **Outlines follow** under Pens to switch between layer and object outlines.
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
