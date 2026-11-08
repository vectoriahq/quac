# `quac:duplicate_policy`

**The QGIS setting:** the `tree_id` field's duplicate policy set to **Remove Value**, under Policies on the Attributes Form tab.

**What the project file holds:** `<duplicatePolicies><policy field="tree_id" policy="UnsetField"/></duplicatePolicies>`.

**What the catalogue says:** the `tree_id` column has `quac:duplicate_policy: "unset"`: a duplicated feature starts with `tree_id` blank. **Use Default Value** gives `"default"`; **Duplicate Value**, QGIS's own default, writes no field.
