# `quac:hidden`

**The QGIS setting:** **Widget Type** set to Hidden for the `tree_id` field on the Attributes Form tab.

**What the project file holds:** `<field name="tree_id"><editWidget type="Hidden">`.

**What the catalogue says:** the `tree_id` column has `quac:hidden: true`: the form never shows it. This is the form's widget, not QGIS Server's settings that keep a field out of WMS or WFS.
