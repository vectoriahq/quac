# Duplicate names QGIS fixture

A hand-written project with two layers both named Roads, both published for WFS. It was not saved by QGIS Desktop. QGIS's own server check reports this as an error, and QGIS Server still publishes both.

The project file's catalogue keeps them apart by their QGIS layer ids. The server catalogue writes both under the id `Roads`, as the project publishes them, so a reader matching by id finds two Collections.
