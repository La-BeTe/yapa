#!/bin/sh
set -eu

DATA_FILE="${TB_DATA_FILE:-/data/0_0.tigerbeetle}"
ADDRESS="${TB_ADDRESS:-0.0.0.0:3000}"
CACHE_GRID="${TB_CACHE_GRID:-256MiB}"

if [ ! -f "$DATA_FILE" ]; then
  echo "formatting $DATA_FILE"
  tigerbeetle format --cluster=0 --replica=0 --replica-count=1 --development "$DATA_FILE"
fi

exec tigerbeetle start --addresses="$ADDRESS" --cache-grid="$CACHE_GRID" --development "$DATA_FILE"
