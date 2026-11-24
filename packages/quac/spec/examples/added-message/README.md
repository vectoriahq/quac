# `quac:added_message` on a Collection

**The QGIS setting:** a layer variable named `quac_added_message`, set to `<h2>Thank you</h2><p>Your tree is on the map.</p>` under **Variables** in the Trees layer's Layer Properties. The variable is QUAC's own; QGIS shows no such message.

**What the project file holds:** the layer's `variableNames` and `variableValues` custom properties, holding `quac_added_message` and the message, its markup escaped as XML escapes it.

**What the catalogue says:** the Trees Collection's `quac:added_message` is the message as written, markup included.
