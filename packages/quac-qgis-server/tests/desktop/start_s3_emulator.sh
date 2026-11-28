#!/bin/sh
# Starts two copies of moto, an S3 emulator, for the QGIS Desktop check's upload:
# on port 5055 one that takes any credentials, and on port 5056 one that checks
# them against its own, which the check's are not, and so refuses them.
# They run in a Python environment of their own, apart from QGIS's.
set -e
work="${RUNNER_TEMP:-/tmp}/s3-emulator"
python3 -m venv "$work/venv"
"$work/venv/bin/pip" install --quiet "moto[server]==5.2.6"
nohup "$work/venv/bin/moto_server" -H 127.0.0.1 -p 5055 > "$work/moto.log" 2>&1 &
INITIAL_NO_AUTH_ACTION_COUNT=0 nohup "$work/venv/bin/moto_server" -H 127.0.0.1 -p 5056 > "$work/moto-refusing.log" 2>&1 &
for port in 5055 5056; do
  tries=0
  until curl -s -o /dev/null "http://127.0.0.1:$port/"; do
    tries=$((tries + 1))
    if [ "$tries" -ge 60 ]; then
      echo "The S3 emulator on port $port did not start:" >&2
      cat "$work"/moto*.log >&2
      exit 1
    fi
    sleep 1
  done
done
echo "The S3 emulator answers on ports 5055 and 5056."
