#!/bin/sh
# Runs the two scanners whose findings block a version on plugins.qgis.org, Bandit
# and detect-secrets, over the plugin's zip as build_plugin.py writes it, and fails
# on any finding of either. plugins.qgis.org blocked 0.8.0 for Bandit's B101, a use
# of assert, which its rules page lists as a warning.
# Run from packages/quac-qgis-server. The scanners go in a Python environment of their own.
set -e
work="${RUNNER_TEMP:-/tmp}/plugin-scan"
rm -rf "$work"
mkdir -p "$work/zip" "$work/plugin"
python3 -m venv "$work/venv"
"$work/venv/bin/pip" install --quiet "bandit==1.9.4" "detect-secrets==1.5.0"
zip_file=$(python3 build_plugin.py "$work/zip")
python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$zip_file" "$work/plugin"
echo "Bandit:"
"$work/venv/bin/bandit" -r -q "$work/plugin"
echo "No findings."
echo "detect-secrets:"
(cd "$work/plugin" && "$work/venv/bin/detect-secrets" scan --all-files .) > "$work/secrets.json"
python3 -c '
import json, sys
results = json.load(open(sys.argv[1]))["results"]
for file_name, found in results.items():
    for finding in found:
        print(f"{file_name}:{finding['"'"'line_number'"'"']} {finding['"'"'type'"'"']}")
sys.exit(1 if results else 0)
' "$work/secrets.json"
echo "No findings."
