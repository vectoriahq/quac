# Project settings QGIS fixture

A made-up project holding the project- and layer-level settings a catalogue carries, and the cases where one names a layer the catalogue does not hold. `settings.qgs` has:

- a point layer marked Private, with an embedded legend placeholder image, a layer icon, field icons named several ways, a Color widget, an added message, and three named styles, the applied one categorised and another graduated;
- a table of inspections that is the child of four relations, of which only the two whose parent the catalogue holds reach it, and one relation with no field pair, which is skipped;
- a layer the project leaves out of WMS, which is also the initial active layer and the parent of one relation and the layer of one filter, all of which the catalogue drops;
- an ArcGIS FeatureServer layer with a `sql=` filter, and a WFS layer whose `srsname` is blank;
- Mergin Maps filters: two kept, one `Text` filter, one on a field the layer does not have, one with a blank `sql_expression`, and one on the left-out layer.

The data files it names are not here: the fixture is read from its text alone. Its layer ids have the shape QGIS writes, a name and a long suffix: QGIS Server 3.44 and 4.2 left this fixture's layers out of GetCapabilities while their ids were as short as `trees_1`, and QGIS Server 3.34 does the same to a layer whose data file is missing when its id is shorter than 11 characters. Tests read the files saved beside it; change them only when the tested parser or catalogue contract changes.
