"""
`python3 -m quac_server <project file> [server address]` prints the catalogue
a QGIS Server at that address serves for the project, as JSON.
`python3 -m quac_server --tree <project file>` prints its server layer tree.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from . import read_server_catalogue, read_server_layer_tree

USAGE = 'Usage: python3 -m quac_server <project.qgs or project.qgz> [server address]\n       python3 -m quac_server --tree <project.qgs or project.qgz>'
EXAMPLE_ADDRESS = 'https://qgis.example.com/ows'


def main(argv: list[str]) -> int:
    args = argv[1:]
    if args[:1] == ['--tree'] and len(args) == 2:
        path = Path(args[1])
        result = read_server_layer_tree(path.name, path.read_bytes())
    elif 1 <= len(args) <= 2 and not args[0].startswith('--'):
        path = Path(args[0])
        result = read_server_catalogue(path.name, path.read_bytes(), args[1] if len(args) == 2 else EXAMPLE_ADDRESS)
    else:
        print(USAGE, file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
