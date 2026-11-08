# `quac:date_format`

**The QGIS setting:** **Widget Type** set to Date/Time for the text field `surveyed`, with the field format `dd/MM/yyyy` and ISO 8601 not ticked.

**What the project file holds:** `<editWidget type="DateTime">` with `field_format` `dd/MM/yyyy` and `field_iso_format` false.

**What the catalogue says:** the `surveyed` column has `quac:date_format: "dd/MM/yyyy"`: its dates are stored as day, month and year. The display format is not read, and a field stored in ISO 8601 writes no field.
