# `quac:locks`

**The setting:** **Disable feature deletion**, ticked on the QField tab of the Trees layer's Layer Properties, which the QFieldSync plugin adds.

**What the project file holds:** the layer custom property `QFieldSync/is_feature_deletion_locked` set to `true`, with its data-defined button off.

**What the catalogue says:** the Trees Collection's `quac:locks` is `{ delete: true }`: no feature can be deleted. With the data-defined button on, the member holds the expression instead, `{ expression: "…" }`.
