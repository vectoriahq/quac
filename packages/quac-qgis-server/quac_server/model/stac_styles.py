"""Mirrors `packages/quac/src/model/stacStyles.ts`, as far as a producer needs: the `default` role and a style asset's key."""

from __future__ import annotations

from typing import Any

# The role marking the asset a Collection nominates as its default style (`packages/quac/spec/README.md` § Styles).
DEFAULT_STYLE_ROLE = 'default'


def style_asset_key(assets: dict[str, Any], name: str) -> str:
    """
    A key for a style asset that does not displace one already in `assets`:
    the style's name, or with ` (2)`, ` (3)` and so on where an asset already
    takes it. The style's own name stays on the asset's `title`.
    """
    if name not in assets:
        return name
    suffix = 2
    while f'{name} ({suffix})' in assets:
        suffix += 1
    return f'{name} ({suffix})'
