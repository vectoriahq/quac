# `quac:filters`

**The setting:** a filter added on the Mergin Maps tab of Project Properties, which the Mergin Maps plugin adds: a **Single select** filter on the Trees layer's `species` field, named Species, with filtering enabled.

**What the project file holds:** `<properties><Mergin><Filtering>`, with `<Enabled>true</Enabled>` and the filters saved as a list in `<Filters>`.

**What the catalogue says:** the Trees Collection's `quac:filters` is `[{ field: "species", name: "Species" }]`. The SQL template the plugin saves beside each filter is not read.
