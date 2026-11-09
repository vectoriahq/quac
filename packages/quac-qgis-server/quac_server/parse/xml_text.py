"""The DOM operations the JavaScript reader uses, on `xml.etree.ElementTree`.

The JavaScript reads the project with the browser's `DOMParser` and selectors.
These helpers give the same answers, so a Python module can follow its
JavaScript counterpart line by line. This module has no JavaScript
counterpart.
"""

from __future__ import annotations

from typing import Optional
from xml.etree.ElementTree import Element


def text_content(element: Element) -> str:
    """The DOM's `textContent`: the text of the element and everything inside it."""
    return ''.join(element.itertext())


def direct_child(parent: Element, tag: str) -> Optional[Element]:
    """The first child named `tag`, as `:scope > tag` selects it."""
    for child in parent:
        if child.tag == tag:
            return child
    return None


def direct_child_text(parent: Element, tag: str) -> Optional[str]:
    """The first child named `tag`'s text, trimmed; None where there is no such child."""
    child = direct_child(parent, tag)
    return text_content(child).strip() if child is not None else None


def first_descendant(parent: Element, tag: str) -> Optional[Element]:
    """The first element named `tag` inside `parent`, in document order, as `querySelector(tag)` finds it."""
    for element in parent.iter(tag):
        if element is not parent:
            return element
    return None


def children_of_kind(parent: Element, outer: str, inner: str) -> list[Element]:
    """
    Every element named `inner` inside `parent` whose own parent is named
    `outer`, in document order, as `querySelectorAll('outer > inner')` finds
    them.
    """
    parent_of = {child: node for node in parent.iter() for child in node}
    return [element for element in parent.iter(inner) if element is not parent and element in parent_of and parent_of[element].tag == outer]
