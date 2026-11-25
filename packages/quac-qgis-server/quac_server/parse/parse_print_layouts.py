"""Mirrors `packages/quac/src/parse/parsePrintLayouts.ts`."""

from __future__ import annotations

import re
from xml.etree.ElementTree import Element  # nosec B405

from ..model.qgs_project import PrintLayoutTemplate
from .project_properties import property_list
from .xml_text import direct_child


def parse_print_layouts(qgis_root: Element) -> list[PrintLayoutTemplate]:
    """
    The project's print layouts, from `<qgis><Layouts>`, each as its name and
    its `<Layout>` element written out by `write_layout_template`, which is what QGIS
    saves as a layout template (`.qpt`). A layout the project leaves out of WMS
    (`WMSRestrictedComposers`) is left out. Reports are not read.
    """
    properties = direct_child(qgis_root, 'properties')
    restricted = set(property_list(properties, 'WMSRestrictedComposers')) if properties is not None else set()
    layouts_element = direct_child(qgis_root, 'Layouts')
    if layouts_element is None:
        return []
    layouts = [PrintLayoutTemplate(name=layout.get('name') or '', template=write_layout_template(layout)) for layout in layouts_element if layout.tag == 'Layout']
    return [layout for layout in layouts if layout.name not in restricted]


# An attribute QGIS writes a layer's data source or provider in.
_SOURCE_ATTRIBUTE = re.compile(r'^(source|provider)$|(Source|Provider)$')

# A value that is a path on the computer that saved the project: from the root of a disk or a home folder, a drive, a network share or a `file:` address.
_ABSOLUTE_PATH = re.compile(r'^\s*(/|\\|~[\\/]|[A-Za-z]:([\\/]|$)|file:)', re.IGNORECASE)


def write_layout_template(element: Element) -> str:
    """
    A layout element as XML text, by the JavaScript's fixed rule: attributes in
    the order the document holds them, an element with no children closed as
    `<name/>`, text that is only white space left out, and `&`, `<`, `>`
    escaped everywhere, with `"`, tab, line feed and carriage return escaped in
    attribute values too. The parser drops comments and processing
    instructions, as the JavaScript leaves them out. Each source or provider
    attribute is left out, and an attribute whose value is an absolute path is
    written empty.
    """
    attributes = ''.join(
        f' {name}="{"" if _ABSOLUTE_PATH.match(value) else _escape_attribute(value)}"'
        for name, value in element.attrib.items()
        if not _SOURCE_ATTRIBUTE.search(name)
    )
    parts: list[str] = []
    if element.text and element.text.strip():
        parts.append(_escape_text(element.text))
    for child in element:
        if isinstance(child.tag, str):
            parts.append(write_layout_template(child))
        if child.tail and child.tail.strip():
            parts.append(_escape_text(child.tail))
    children = ''.join(parts)
    if children == '':
        return f'<{element.tag}{attributes}/>'
    return f'<{element.tag}{attributes}>{children}</{element.tag}>'


def _escape_text(text: str) -> str:
    return text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def _escape_attribute(value: str) -> str:
    return _escape_text(value).replace('"', '&quot;').replace('\t', '&#9;').replace('\n', '&#10;').replace('\r', '&#13;')
