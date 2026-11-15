# `quac:values`

**The QGIS setting:** a **Value Map** widget on the `status` field under Attributes Form in the Trees layer's Layer Properties, with three rows: `healthy` shown as Healthy, `stressed` shown as Stressed, and the blank value shown as Not recorded.

**What the project file holds:** `<editWidget type="ValueMap">`, whose `map` list holds one `<Option>` per row, with the row's description as `name` and its value as `value`. The blank row's value is QGIS's code `{2839923C-8B7D-419E-B84B-CA2FE9B80EC7}`.

**What the catalogue says:** the `status` column has `quac:values: [{ value: "healthy", label: "Healthy" }, { value: "stressed", label: "Stressed" }, { value: "", label: "Not recorded" }]`, in the widget's order, with the blank row's value as `""`.
