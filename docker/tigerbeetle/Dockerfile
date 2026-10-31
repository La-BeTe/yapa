# Thin wrapper around the official static TigerBeetle binary that formats the
# data file on first boot, so `docker compose up` needs no manual step.
FROM alpine:3.22

ARG TIGERBEETLE_VERSION=0.17.9

# Detect the architecture from the build container itself: TARGETARCH is only set by
# BuildKit, and the legacy builder (e.g. Colima without buildx) would otherwise fetch the
# x86_64 binary on ARM, which hangs under emulation.
RUN set -eux; \
    arch="$(uname -m)"; \
    case "$arch" in \
      x86_64|aarch64) ;; \
      *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac; \
    wget -q -O /tmp/tb.zip "https://github.com/tigerbeetle/tigerbeetle/releases/download/${TIGERBEETLE_VERSION}/tigerbeetle-${arch}-linux.zip"; \
    unzip -q /tmp/tb.zip -d /usr/local/bin; \
    rm /tmp/tb.zip; \
    chmod +x /usr/local/bin/tigerbeetle; \
    tigerbeetle version

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME /data
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
