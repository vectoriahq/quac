# `quac:form_order`

**The QGIS setting:** **Drag and Drop Designer** chosen on the Attributes Form tab of the Trees layer's Layer Properties, with `species` placed first, `tree_id` second, and `planted` left out of the form.

**What the project file holds:** `<editorlayout>tablayout</editorlayout>` and an `<attributeEditorForm>` holding the two placed fields, in order.

**What the catalogue says:** the Trees Collection's `quac:form_order` is `["species", "tree_id"]`. Columns appear here only where they carry a `quac:` field, so `planted` appears with `quac:in_form: false`, the field the layout leaves out.
