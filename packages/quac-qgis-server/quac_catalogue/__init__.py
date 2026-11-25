"""
The QUAC Catalogue plugin, one plugin for QGIS Server and QGIS Desktop.

QGIS Server starts it through `serverClassFactory`: `SERVICE=QUAC&REQUEST=GetCatalogue&MAP=<project>`
answers the open project's catalogue (`service.py`). QGIS Desktop starts it
through `classFactory`: on each save of a project with the option on, the
project's catalogue is written into a chosen folder (`desktop.py`). Each
imports its own part only, so the server never loads `qgis.gui`. An installed
copy holds `quac_server` inside this folder; `catalogue.py`, `access.py` and
`publish.py` need no QGIS module, so their tests run anywhere.
"""


def serverClassFactory(server_iface):  # noqa: N802 - the name QGIS Server calls
    from .service import QuacCatalogue

    return QuacCatalogue(server_iface)


def classFactory(iface):  # noqa: N802 - the name QGIS Desktop calls
    from .desktop import QuacDesktop

    return QuacDesktop(iface)
