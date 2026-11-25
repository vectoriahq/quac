"""Mirrors `packages/quac/src/parse/parseExtent.ts`."""

from __future__ import annotations

from typing import Optional
from xml.etree.ElementTree import Element  # nosec B405

from ..js_compat import is_finite, js_number, js_trim
from ..model.qgs_project import MapExtent
from .xml_text import first_descendant, text_content


def parse_map_extent(qgis_root: Element, project_crs: Optional[str]) -> Optional[MapExtent]:
    """
    The map view the project saves, `<mapcanvas><extent>`, in the coordinate
    system of the canvas's `<destinationsrs>`, or the project's where the
    canvas names none. The first `<mapcanvas>` is the main view. None where no
    usable extent is found.
    """
    try:
        mapcanvas = first_descendant(qgis_root, 'mapcanvas')
        if mapcanvas is None:
            return None
        extent = first_descendant(mapcanvas, 'extent')
        if extent is None:
            return None
        xmin = _read_number(extent, 'xmin')
        ymin = _read_number(extent, 'ymin')
        xmax = _read_number(extent, 'xmax')
        ymax = _read_number(extent, 'ymax')
        if xmin is None or ymin is None or xmax is None or ymax is None:
            return None
        authid = _select_first(mapcanvas, ('destinationsrs', 'spatialrefsys', 'authid'))
        canvas_crs = (js_trim(text_content(authid)) if authid is not None else '') or None
        return MapExtent(xmin=xmin, ymin=ymin, xmax=xmax, ymax=ymax, crs=canvas_crs if canvas_crs is not None else project_crs)
    except Exception:  # noqa: BLE001 - as the JavaScript, an unreadable extent is no extent
        return None


def _read_number(parent: Element, tag: str) -> Optional[float]:
    node = first_descendant(parent, tag)
    text = js_trim(text_content(node)) if node is not None else ''
    if not text:
        return None
    value = js_number(text)
    return value if is_finite(value) else None


def _select_first(scope: Element, tags: tuple[str, ...]) -> Optional[Element]:
    """
    The first element inside `scope`, in document order, named `tags[-1]` with
    ancestors named the earlier tags in turn, each inside the one before, as
    `querySelector('a b c')` finds it.
    """
    parent_of = {child: node for node in scope.iter() for child in node}
    for element in scope.iter(tags[-1]):
        if element is scope:
            continue
        remaining = list(tags[:-1])
        node = parent_of.get(element)
        while remaining and node is not None:
            if node.tag == remaining[-1]:
                remaining.pop()
            node = parent_of.get(node)
        if not remaining:
            return element
    return None
