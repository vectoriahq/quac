# `quac:constraints`, with an expression

**The QGIS setting:** an **Expression** constraint on the `height` field under Constraints on the Attributes Form tab, `"height" < 80 AND "height" > 0`, described as `Between 0 and 80 metres`, with **Enforce expression constraint** unticked.

**What the project file holds:** `<constraint field="height" constraints="4" exp_strength="2"/>`: bit 4 of `constraints` is the expression, and strength 2 warns rather than refuses. The expression is in `<constraintExpressions>`, in the `exp` attribute, where QGIS escapes its `<` and `>` as `&lt;` and `&gt;` and its quotes as `&quot;`.

**What the catalogue says:** the `height` column has `quac:constraints: { expression: { expression: "\"height\" < 80 AND \"height\" > 0", description: "Between 0 and 80 metres", strength: "warn" } }`, the expression as QGIS wrote it before escaping. Ticking **Enforce** gives `"enforced"`.
