# `quac:print_layouts`

**The QGIS setting:** two print layouts in the Layout Manager, **Park plan** and **Internal check**, with **Internal check** listed under **Exclude layouts** in Project Properties → QGIS Server → WMS capabilities. **Park plan** has a map showing the Parks layer, a title, a logo picture and an atlas over Parks.

**What the project file holds:** each layout as a `<Layout>` element under `<Layouts>`, and the excluded one's name in `<properties><WMSRestrictedComposers>`. QGIS writes the Parks layer's source and provider on the map's `<Layer>` and on the `<Atlas>`, and the logo's path from the root of the disk.

**What the catalogue says:** the top-level Catalog's `quac:print_layouts` holds **Park plan** alone, with its `<Layout>` element as its `template`. The template keeps the layer's id and name and leaves out its source and provider, and its logo's `file` is empty.
