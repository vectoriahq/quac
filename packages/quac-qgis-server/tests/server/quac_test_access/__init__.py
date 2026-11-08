"""
An access-control plugin used only by the QUAC catalogue plugin's CI job
(`docs/plans/quac-separation.md`, package 6). While a request carries
`TESTUSER`, it gives QGIS Server that value as a cache key, as an access plugin
does for a signed-in person, and refuses what `rules.py` lists for that
person: reading a layer, adding, changing or deleting its features, and seeing
a field. Without `TESTUSER` it allows everything and gives no key.
"""

from __future__ import annotations

from qgis.server import QgsAccessControlFilter

from .rules import rule_for


class TestAccess(QgsAccessControlFilter):
    def __init__(self, server_iface):
        super().__init__(server_iface)
        self._server_iface = server_iface

    def _user(self) -> str:
        return self._server_iface.requestHandler().parameterMap().get('TESTUSER', '')

    def cacheKey(self):  # noqa: N802 - the name QGIS Server calls
        return self._user()

    def layerPermissions(self, layer):  # noqa: N802 - the name QGIS Server calls
        rule = rule_for(self._user(), layer.name())
        permissions = QgsAccessControlFilter.LayerPermissions()
        permissions.canRead = rule.get('read', True)
        permissions.canInsert = rule.get('insert', True)
        permissions.canUpdate = rule.get('update', True)
        permissions.canDelete = rule.get('delete', True)
        return permissions

    def authorizedLayerAttributes(self, layer, attributes):  # noqa: N802 - the name QGIS Server calls
        hidden = set(rule_for(self._user(), layer.name()).get('hidden', []))
        return [attribute for attribute in attributes if attribute not in hidden]


def serverClassFactory(server_iface):  # noqa: N802 - the name QGIS Server calls
    access = TestAccess(server_iface)
    server_iface.registerAccessControl(access, 100)
    return access
