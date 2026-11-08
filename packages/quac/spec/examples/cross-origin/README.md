# `quac:cross_origin`

**The source:** none. No producer writes this field; a catalogue's author writes it by hand. This example is such a catalogue: one layer of aerial imagery tiles, from a server that sends cross-origin headers.

**What the catalogue says:** the Aerial Collection's `quac:cross_origin` is `true`: its tiles are requested with cross-origin access, so an exported map image can include them. It also states `quac:max_zoom: 19`, the deepest tile level requested.
