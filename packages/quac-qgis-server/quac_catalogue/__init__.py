"""
The QUAC catalogue plugin for QGIS Server. `SERVICE=QUAC&REQUEST=GetCatalogue&MAP=<project>` answers the
open project's catalogue. An installed copy holds `quac_server` inside this
folder; `catalogue.py` needs no QGIS module, so its tests run anywhere.
"""


def serverClassFactory(server_iface):  # noqa: N802 - the name QGIS Server calls
    from .service import QuacCatalogue

    return QuacCatalogue(server_iface)
