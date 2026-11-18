#!/usr/bin/env bash
# Keep the free yourname.duckdns.org name pointing at this server (only needed if the public IP can change).
#   DUCKDNS_SUBDOMAIN=yourname DUCKDNS_TOKEN=xxxxxxxx bash duckdns.sh
set -euo pipefail
: "${DUCKDNS_SUBDOMAIN:?}" "${DUCKDNS_TOKEN:?}"
curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=" && echo
