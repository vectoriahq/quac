# `quac:related_to`

**The QGIS setting:** a relation added under **Relations** in Project Properties: Trees is the referenced (parent) layer, Inspections the referencing (child) layer, joined on `tree_id`.

**What the project file holds:** `<relation id="tree_inspections" name="Inspections" referencedLayer="trees_1" referencingLayer="inspections_1">` with `<fieldRef referencedField="tree_id" referencingField="tree_id"/>`.

**What the catalogue says:** the Inspections Collection's `quac:related_to` names the relation, its parent Collection `trees_1`, and the join as `{ parent: "tree_id", child: "tree_id" }`. The relation is written on the child; the Trees Collection carries no field for it.
