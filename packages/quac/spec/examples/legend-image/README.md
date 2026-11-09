# `quac:legend_image`

**The QGIS setting:** **Legend placeholder image** on the Legend tab of Layer Properties, with the image embedded in the project rather than linked.

**What the project file holds:** `<maplayer legendPlaceholderImage="base64:iVBORw0KGgo…">`, the image's bytes.

**What the catalogue says:** the Trees Collection's `quac:legend_image` is the image as a `data:image/png;base64,…` address; its type is read from the bytes it opens with. A placeholder that names a file or a web address writes nothing.
