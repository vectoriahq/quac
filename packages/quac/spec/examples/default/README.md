# `quac:default`

**The QGIS setting:** **Default value** set to `now()` for the `planted` field on the Attributes Form tab, with **Apply default value on update** unticked.

**What the project file holds:** `<defaults><default field="planted" expression="now()" applyOnUpdate="0"/></defaults>`.

**What the catalogue says:** the `planted` column has `quac:default: { kind: "now", on_update: false }`: a new feature's blank `planted` is filled with the moment it is created. A lone literal default gives `kind: "fixed"`, `uuid()` gives `kind: "uuid"`, and another expression gives `kind: "expression"`.
