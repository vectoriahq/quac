# `quac:value_relation`

**The QGIS setting:** **Widget Type** set to Value Relation for the Trees layer's `species` field, with the Species layer, **Key column** `code`, **Value column** `common_name`, and **Order By** set to **Value**.

**What the project file holds:** `<editWidget type="ValueRelation">` with `Layer` `species_1`, `Key` `code`, `Value` `common_name` and `OrderByValue` true.

**What the catalogue says:** the `species` column has `quac:value_relation: { collection: "species_1", key: "code", value: "common_name", order_by: "value" }`: its choices are the Species records, storing `code` and showing `common_name`.
