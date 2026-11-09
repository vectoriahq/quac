# `quac:icon` from a library other than Tabler

**The QGIS setting:** a layer variable named `quac_icon_species`, set to `lucide:tree-pine` under **Variables** in the Trees layer's Layer Properties: Lucide's tree-pine icon, named as Iconify names it.

**What the project file holds:** the layer's `variableNames` and `variableValues` custom properties, holding `quac_icon_species` and `lucide:tree-pine`.

**What the catalogue says:** the `species` column has `quac:icon` set to the address of Lucide's `tree-pine` file in its npm package, `lucide-static`, at major version 1. The field reference lists every library a name can come from.
