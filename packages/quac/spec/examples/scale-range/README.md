# `quac:min_scale` and `quac:max_scale`

**The QGIS setting:** **Scale Dependent Visibility** on the Rendering tab of Layer Properties, ticked, with **Minimum (exclusive)** 1:25,000 and **Maximum (inclusive)** 1:500.

**What the project file holds:** `<maplayer hasScaleBasedVisibilityFlag="1" minScale="25000" maxScale="500">`.

**What the catalogue says:** the Trees Collection's `quac:min_scale` is `25000`, the most zoomed-out scale the layer shows at, and its `quac:max_scale` is `500`, the most zoomed-in. With the box unticked QGIS still saves both numbers, and the catalogue writes neither.
