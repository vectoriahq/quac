"""Mirrors `packages/quac/src/generate/wmsStacCatalogue.ts`, as far as the server route needs: the column type of a field QGIS Server reports.

The GetProjectSettings producer itself is not ported; `port-exemptions.json`
lists it.
"""

from __future__ import annotations

from typing import Optional

# Qt type names, as QGIS Server writes them, mapped to column types. They are
# more deterministic than the human type name, which can vary by locale.
_QT_COLUMN_TYPES = {
    'int': 'int',
    'qlonglong': 'long',
    'double': 'double',
    'float': 'double',
    'bool': 'boolean',
    'QDateTime': 'timestamp',
    'QDate': 'date',
    'QTime': 'time',
    'QString': 'string',
}


def map_qt_type_to_stac_table_type(qt_type: str, type_name: str) -> Optional[str]:
    """A field's column type from its Qt type name, falling back to its provider's type name, lower-cased, for an unfamiliar one."""
    if qt_type in _QT_COLUMN_TYPES:
        return _QT_COLUMN_TYPES[qt_type]
    return type_name.lower() if type_name else None
