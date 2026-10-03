#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
root=$(pwd)
HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK=1 brew install libimobiledevice libirecovery libtatsu libzip autoconf automake libtool pkgconf
mkdir -p .tools/src
if [ ! -d .tools/src/idevicerestore/.git ]; then
 git clone https://github.com/libimobiledevice/idevicerestore.git .tools/src/idevicerestore
 git -C .tools/src/idevicerestore checkout 68e5dc907efcbca70747f9ce2cc5975f8ae8b72d
fi
if [ "$(git -C .tools/src/idevicerestore rev-parse HEAD)" != '68e5dc907efcbca70747f9ce2cc5975f8ae8b72d' ]; then
 echo 'Unexpected restore-engine revision. Refusing to build.' >&2
 exit 1
fi
python3 - <<'PY'
from pathlib import Path
p=Path('.tools/src/idevicerestore/src/download.c')
s=p.read_text().replace('/* disable SSL verification to allow download from untrusted https locations */','/* PwnMyFone: require valid TLS certificates for firmware metadata/downloads. */').replace('CURLOPT_SSL_VERIFYPEER, 0','CURLOPT_SSL_VERIFYPEER, 1L')
assert s.count('CURLOPT_SSL_VERIFYPEER, 1L') == 2, 'Unexpected upstream TLS configuration'
p.write_text(s)
PY
(
 cd .tools/src/idevicerestore
 PKG_CONFIG_PATH="/opt/homebrew/lib/pkgconfig:/opt/homebrew/opt/openssl@3/lib/pkgconfig:/opt/homebrew/opt/libzip/lib/pkgconfig" ./autogen.sh --prefix="$root/.tools/install" --without-limera1n
 make -j4
)
python3 scripts/bundle-macos-helpers.py
