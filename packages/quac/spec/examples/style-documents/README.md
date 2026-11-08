# `quac:light_style`, `quac:dark_style` and `quac:style_overrides`

**The source:** none. No producer writes these fields; a catalogue's author writes them by hand. This example is such a catalogue: a street basemap offered as two style documents, Bright and Dark.

**What the catalogue says:**

- the Streets Collection's `quac:light_style` is `Bright` and its `quac:dark_style` is `Dark`: the style drawn in a light theme and in a dark theme, each by its asset's title;
- the Bright style asset's `quac:style_overrides` lists two overrides merged into the style before it is drawn: one by address, and one written in place that hides the `ferry` layer.
