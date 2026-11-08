"""
The test people the QUAC catalogue plugin's CI job asks as, by the value of a
request's `TESTUSER`, and what each may not do, by QGIS layer name. No QGIS
module, so `check_catalogue.py` reads the same rules to work out what each
person's catalogue must be.
"""

from __future__ import annotations

RULES: dict[str, dict[str, dict]] = {
    # server-publishing
    'no-notes': {'Survey notes': {'read': False}},
    'no-zone-code': {'Parcels': {'hidden': ['zone_code']}},
    'read-only': {'Parcels': {'insert': False, 'update': False, 'delete': False}},
    # server-groups: the one layer of its Monitoring group
    'no-sites': {'Sites': {'read': False}},
}


def rule_for(user: str, layer_name: str) -> dict:
    """What the person may not do on the layer; empty where nothing is refused."""
    return RULES.get(user, {}).get(layer_name, {})
