# `quac:constraints`

**The QGIS setting:** **Not null** and **Enforce not null constraint**, both ticked for the `species` field under Constraints on the Attributes Form tab.

**What the project file holds:** `<constraint field="species" constraints="1" notnull_strength="1"/>`: bit 1 of `constraints` is not null, and strength 1 enforces it.

**What the catalogue says:** the `species` column has `quac:constraints: { not_null: "enforced" }`. Unticking **Enforce** gives `"warn"`; the Unique box and an expression constraint add `unique` and `expression`.
