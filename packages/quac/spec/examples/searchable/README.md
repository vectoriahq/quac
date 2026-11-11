# `quac:searchable`

**The QGIS setting:** **Not searchable** ticked in the Configuration column for the `species` field on the Fields tab.

**What the project file holds:** `<field configurationFlags="NotSearchable" name="species"/>`.

**What the catalogue says:** the `species` column has `quac:searchable: false`: a search of the layer's features skips it. The field is still shown and can still be changed.
