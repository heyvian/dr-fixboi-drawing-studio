# Drawing Studio workspace redesign

| Workflow | Where it lives | Design reason |
| --- | --- | --- |
| Find and open saved sheets or toggle imported layers | Project browser | Keep a model’s saved work in a visible list. The row names the view and shows its projection and saved scale. Opening from Model space takes you to the sheet. |
| Save, update, rename, or delete a view | Project browser | Give each action its own verb. Save as creates a view, Update replaces a snapshot, and Rename preserves its settings. Confirm replacement or deletion. |
| Change how the model is viewed | Model space and Camera properties | Match the compass to the active projection and keep it outside the canvas. Display properties control 3D edges. |
| Work on the sheet | Drawing sheet toolbar | Projection, scale, and placement are next to the sheet. Capturing the camera is explicit, so orbiting the model leaves the sheet framing intact. |
| Change drawing properties | View, Paper, Pens, and Cuts | Keep perspective and orientation under View, physical paper and contrast under Paper, print styles under Pens, and clipping geometry and hatch under Cuts. |
| Browse on a phone | Model and sheet viewports | Keep model loading, projections, fitting, and saved-view browsing. Move drafting controls out of the phone layout. |

## References and decisions

- Rhino’s Named Views panel and SketchUp Scenes distinguish a named snapshot from the current viewport. Drawing Studio shows saved sheet views in a browser with explicit Save as, Open, Update, Rename, and Delete actions. [Rhino NamedViewTable](https://github.com/mcneel/rhinocommon-api-docs/blob/gh-pages/api/RhinoCommon/html/T_Rhino_DocObjects_Tables_NamedViewTable.htm) · [SketchUp Pages](https://github.com/SketchUp/ruby-api-docs/blob/main/Sketchup/Pages.html)
- Revit’s Project Browser and the model/layout distinction shaped the workspace organization. FreeCAD’s documentation provides an inspectable comparison for the project tree, properties, and separate TechDraw pages. Drawing Studio keeps one working sheet and named snapshots per imported model. [Revit Help](https://help.autodesk.com/view/RVT/2026/ENU/) · [FreeCAD interface](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Interface.md) · [TechDraw](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/TechDraw_Workbench.md)
- Photoshop and Illustrator use context-specific panels around a stable canvas. Inkscape shows colours and numeric stroke styles in distinct sections, and FreeCAD groups technical line types. Drawing Studio puts the pen sample, printed width, and colour on one row and places the depth diagram directly below. [Photoshop workspace](https://helpx.adobe.com/photoshop/using/workspace-basics.html) · [Illustrator workspace](https://helpx.adobe.com/illustrator/using/workspace-basics.html) · [Inkscape Fill and Stroke](https://gitlab.com/inkscape/inkscape-docs/manuals/-/blob/master/Inkscape-Beginners-Guide/source/fill-and-stroke-dialog.rst) · [TechDraw line groups](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/TechDraw_LineGroup.md)

The cloud network blocked direct access to the Adobe, Autodesk, Rhino Help, and SketchUp Help sites. The comparison uses the published upstream documentation available through GitHub and GitLab and treats the commercial tools as design references.

## Accessibility checks

The workspace uses native form controls, focusable viewports, native dialogs, and tabs with arrow, Home, and End navigation. Active states use borders and text as well as colour. The viewport shortcut bypasses the project browser and toolbar. [WAI-ARIA tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

The sheet contrast check compares visible pen and cut styles with the selected paper. It uses 3:1 for graphic marks and 4.5:1 for labels. It accounts for stroke opacity and proposes the nearest qualifying tone. When the fade prevents any ink colour from passing, the suggestion also adjusts that fade. Check shaded areas and the background of transparent exports in their intended context. [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) · [WCAG graphics and controls](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
