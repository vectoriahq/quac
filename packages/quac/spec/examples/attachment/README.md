# `quac:attachment`

**The QGIS setting:** **Widget Type** set to Attachment for the `photo` field, showing the file as an image, with the default path `photos`, paths stored relative to the project, and the filter `Images (*.jpg *.png)`.

**What the project file holds:** `<editWidget type="ExternalResource">` with `DocumentViewer` 1, `DefaultRoot` `photos`, `RelativeStorage` 1 and that `FileWidgetFilter`.

**What the catalogue says:** the `photo` column has `quac:attachment: { viewer: "image", filter: "Images (*.jpg *.png)", default_root: "photos", relative_storage: "project" }`: the field holds a path to an image file.
