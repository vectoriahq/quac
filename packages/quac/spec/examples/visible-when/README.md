# `quac:visible_when`

**The QGIS setting:** a **Drag and Drop Designer** form on the Attributes Form tab, with `removal_reason` inside a group box named Removal whose **Control Visibility by Expression** is ticked and set to `"status" = 'Removed'`.

**What the project file holds:** an `<attributeEditorContainer name="Removal">` with `visibilityExpression="&quot;status&quot; = 'Removed'"` and `visibilityExpressionEnabled="1"`, holding the field.

**What the catalogue says:** the `removal_reason` column has `quac:visible_when: ["\"status\" = 'Removed'"]`: the form shows the field only while the expression is true. A field inside nested containers lists each container's expression, outermost first.
