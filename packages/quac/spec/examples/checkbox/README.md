# `quac:checkbox`

**The QGIS setting:** **Widget Type** set to Checkbox for the text field `heritage`, with `Y` as the checked state and `N` as the unchecked state.

**What the project file holds:** `<editWidget type="CheckBox">` with `CheckedState` `Y` and `UncheckedState` `N`.

**What the catalogue says:** the `heritage` column has `quac:checkbox: { checked: "Y", unchecked: "N" }`: the values the field holds for ticked and unticked. Every Checkbox widget writes the field, so `{}` is a plain checkbox.
