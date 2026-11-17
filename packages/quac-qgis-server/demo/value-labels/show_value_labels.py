"""
Shows, for each field with a Value Map, what a web map gets from QGIS Server
for the same features:

- **WFS GetFeature**, where QGIS Server gives the value the field stores;
- **WMS GetFeatureInfo**, where it gives that value's label;
- **WFS GetFeature read with the QUAC catalogue**, where the column's
  `quac:values` turns each stored value back into its label.

The fields come from GetProjectSettings, which names each field's widget
(`editType="ValueMap"`) but not its list. It also shows each layer's display
field as GetProjectSettings gives it and as the catalogue gives it.

`python3 show_value_labels.py <server> <MAP>` asks the QGIS Server at
`<server>/ows/` for the project `<MAP>`, prints Markdown, and exits with 1
where a label read through the catalogue differs from GetFeatureInfo's,
including where the catalogue gives no list. The server needs the QUAC
Catalogue plugin. It uses Python's standard library only.
"""

from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from typing import Any, Optional
from xml.etree import ElementTree


def ask(server: str, project: str, **params: str) -> bytes:
    query = urllib.parse.urlencode({'MAP': project, **params})
    with urllib.request.urlopen(f'{server.rstrip("/")}/ows/?{query}', timeout=60) as answer:
        return answer.read()


def local(element: ElementTree.Element) -> str:
    return element.tag.rsplit('}', 1)[-1]


def as_text(value: Any) -> str:
    """A stored value as the text a Value Map compares it with: a blank for null, and a whole number without a decimal point."""
    if value is None:
        return ''
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def label_of(value: Any, values: Optional[list[dict[str, Any]]]) -> str:
    """The label `quac:values` gives a stored value, the value in brackets where the list has none, as QGIS shows it, or a dash with no list."""
    if not values:
        return '— (no list)'
    text = as_text(value)
    for entry in values:
        if as_text(entry['value']) == text:
            return entry['label']
    return f'({text})'


def value_map_layers(server: str, project: str) -> dict[str, dict[str, Any]]:
    """Each WMS layer with a Value Map field, from GetProjectSettings: its display field and its Value Map fields' names and aliases."""
    root = ElementTree.fromstring(ask(server, project, SERVICE='WMS', REQUEST='GetProjectSettings'))
    layers: dict[str, dict[str, Any]] = {}
    for layer in root.iter():
        if local(layer) != 'Layer':
            continue
        name = next((child.text for child in layer if local(child) == 'Name'), None)
        attributes = [child for child in layer if local(child) == 'Attributes']
        coded = {
            attribute.get('name', ''): attribute.get('alias') or attribute.get('name', '')
            for block in attributes for attribute in block
            if local(attribute) == 'Attribute' and attribute.get('editType') == 'ValueMap'
        }
        if name and coded:
            layers[name] = {'display_field': layer.get('displayField'), 'coded': coded}
    return layers


def collections_of(catalog: dict[str, Any]) -> list[dict[str, Any]]:
    found = list(catalog.get('collections', []))
    for child in catalog.get('catalogs', []):
        found.extend(collections_of(child))
    return found


def wfs_features(server: str, project: str, type_name: str) -> dict[str, dict[str, Any]]:
    """Each feature's properties from WFS GetFeature as GeoJSON, by the feature id QGIS gives it."""
    answer = json.loads(ask(server, project, SERVICE='WFS', VERSION='1.1.0', REQUEST='GetFeature', TYPENAME=type_name, OUTPUTFORMAT='GeoJSON'))
    return {str(feature['id']).rsplit('.', 1)[-1]: feature['properties'] for feature in answer['features']}


def feature_info(server: str, project: str, wms_name: str, key_field: str, bbox: list[float]) -> dict[str, dict[str, str]]:
    """Each feature's attributes from WMS GetFeatureInfo, by its feature id, keyed by the name GetFeatureInfo gives them: the alias where there is one."""
    west, south, east, north = bbox
    answer = ask(
        server, project, SERVICE='WMS', VERSION='1.3.0', REQUEST='GetFeatureInfo', LAYERS=wms_name, QUERY_LAYERS=wms_name,
        CRS='EPSG:4326', BBOX=f'{south},{west},{north},{east}', WIDTH='100', HEIGHT='100', INFO_FORMAT='text/xml',
        FEATURE_COUNT='1000', FILTER=f'{wms_name}:"{key_field}" IS NOT NULL',
    )
    root = ElementTree.fromstring(answer)
    return {
        feature.get('id', ''): {attribute.get('name', ''): attribute.get('value', '') for attribute in feature.iter('Attribute')}
        for feature in root.iter('Feature')
    }


def main(server: str, project: str) -> int:
    catalogue = json.loads(ask(server, project, SERVICE='QUAC', REQUEST='GetCatalogue'))
    by_wms_name = {collection.get('quac:qgis_server_wms_name'): collection for collection in collections_of(catalogue)}
    rows = ['| Feature | Field | WFS GetFeature | WMS GetFeatureInfo | WFS with `quac:values` |', '|---|---|---|---|---|']
    notes: list[str] = []
    differences = 0
    for wms_name, settings in value_map_layers(server, project).items():
        collection = by_wms_name.get(wms_name)
        type_name = collection.get('quac:qgis_server_wfs_type_name') if collection else None
        if not collection or not type_name:
            notes.append(f'- {wms_name}: not published for WFS, so not compared.')
            continue
        columns = {column['name']: column for column in collection.get('table:columns', [])}
        key_field = collection.get('quac:display_field') or next(iter(columns))
        notes.append(
            f'- {wms_name}: GetProjectSettings gives the display field as `{settings["display_field"]}`; '
            f'the catalogue\'s `quac:display_field` is `{collection.get("quac:display_field")}`, the name WFS uses.'
        )
        from_wfs = wfs_features(server, project, type_name)
        from_wms = feature_info(server, project, wms_name, key_field, collection['extent']['spatial']['bbox'][0])
        for feature_id, properties in sorted(from_wfs.items()):
            for name, alias in settings['coded'].items():
                stored = properties.get(name)
                shown = from_wms.get(feature_id, {}).get(alias, '—')
                read = label_of(stored, columns.get(name, {}).get('quac:values'))
                if read != shown:
                    differences += 1
                rows.append(f'| {properties.get(key_field, feature_id)} | {alias} | `{json.dumps(stored)}` | {shown} | {read} |')
    print('\n'.join(rows))
    print()
    print('\n'.join(notes))
    if differences:
        print(f'\n{differences} label(s) read through the catalogue differ from GetFeatureInfo.', file=sys.stderr)
    return 1 if differences else 0


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1], sys.argv[2]))
