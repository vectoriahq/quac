# `quac:editable_when`

**The QGIS setting:** on a **Drag and Drop Designer** form, the `condition` field's **Editable** box has its data-defined override set to the expression `"last_inspected" IS NULL`.

**What the project file holds:** a `<dataDefinedFieldProperties>` entry for `condition` whose `dataDefinedEditable` property is active, with that expression.

**What the catalogue says:** the `condition` column has `quac:editable_when: "\"last_inspected\" IS NULL"`: the form locks the field once `last_inspected` is filled in.
