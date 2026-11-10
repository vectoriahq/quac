"""
Writes the front page of https://vectoriahq.github.io/quac/ into a checkout of
the gh-pages branch, listing every schema version the branch holds, newest
first. Python's standard library only.

`python3 build_site.py <gh-pages folder>` writes `index.html` and
`quac-mark.svg` there. The schema workflow runs it after copying the schema.
"""

from __future__ import annotations

import re
import shutil
import sys
from html import escape
from pathlib import Path

SITE = Path(__file__).resolve().parent
MARK = SITE.parent / 'assets' / 'quac-mark.svg'
ADDRESS = 'https://vectoriahq.github.io/quac/'
PLACEHOLDER = '<!-- schema versions -->'
VERSION_FOLDER = re.compile(r'^v(\d+)\.(\d+)\.(\d+)$')


def schema_versions(pages: Path) -> list[str]:
    """The version folders on the branch that hold a schema, newest first."""
    found = [
        (tuple(int(part) for part in match.groups()), folder.name)
        for folder in pages.iterdir()
        if (match := VERSION_FOLDER.match(folder.name)) and (folder / 'schema.json').is_file()
    ]
    return [name for _, name in sorted(found, reverse=True)]


def build(pages: Path) -> None:
    items = '\n'.join(
        f'    <li><a href="{escape(name)}/schema.json"><code>{escape(ADDRESS + name)}/schema.json</code></a></li>'
        for name in schema_versions(pages)
    )
    page = (SITE / 'index.html').read_text(encoding='utf-8')
    if PLACEHOLDER not in page:
        sys.exit(f'site/index.html has no {PLACEHOLDER} line.')
    (pages / 'index.html').write_text(page.replace(PLACEHOLDER, items), encoding='utf-8')
    shutil.copy(MARK, pages / 'quac-mark.svg')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Usage: python3 build_site.py <gh-pages folder>')
    build(Path(sys.argv[1]))
