#!/bin/sh
# One-time, per-Mac setup for `npm run package:mac:dev`: creates a
# self-signed "Workspace Launcher Dev" code-signing identity in the
# login keychain.
#
# Why: an ad-hoc signed test build gets a new identity on every
# rebuild, and macOS ties the Accessibility grant (and the app's
# Keychain items) to that identity — so every rebuild silently drops
# the grant while System Settings still shows it ON. A build signed
# with one stable certificate keeps the same identity across rebuilds.
#
# What it does: generates a key + certificate restricted to code
# signing, imports them into the login keychain (only /usr/bin/codesign
# may use the key without asking), and trusts the certificate for the
# code-signing policy only, for this user only — macOS asks for your
# password for that step. Nothing else on the system trusts it, and
# it's useless for distribution (that needs a real Developer ID).
#
# Idempotent: exits early if the identity already exists. To remove
# it: Keychain Access → login → My Certificates → delete
# "Workspace Launcher Dev".

set -eu

NAME="Workspace Launcher Dev"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
# The system LibreSSL, never whatever `openssl` is first on PATH: a
# Homebrew OpenSSL 3+/4 writes PKCS#12 with AES/PBKDF2, which
# `security import` can't read and misreports as "MAC verification
# failed (wrong password?)".
OPENSSL=/usr/bin/openssl

if security find-identity -v -p codesigning | grep -q "\"$NAME\""; then
  echo "create-dev-signing-cert: \"$NAME\" already exists and is valid for code signing."
  exit 0
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

cat >"$WORK/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
EOF

# A random one-time password: the .p12 only exists inside $WORK for
# the import below and is deleted on exit.
P12_PASS=$("$OPENSSL" rand -hex 16)

"$OPENSSL" req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -config "$WORK/cert.cnf" -keyout "$WORK/key.pem" -out "$WORK/cert.pem" 2>/dev/null
"$OPENSSL" pkcs12 -export -inkey "$WORK/key.pem" -in "$WORK/cert.pem" \
  -name "$NAME" -out "$WORK/dev.p12" -passout "pass:$P12_PASS"

security import "$WORK/dev.p12" -k "$KEYCHAIN" -P "$P12_PASS" -T /usr/bin/codesign
echo "create-dev-signing-cert: macOS will now ask for your password to trust it for code signing."
security add-trusted-cert -p codeSign -k "$KEYCHAIN" "$WORK/cert.pem"

if ! security find-identity -v -p codesigning | grep -q "\"$NAME\""; then
  echo "create-dev-signing-cert: imported, but \"$NAME\" isn't listed as a valid code-signing identity." >&2
  exit 1
fi
echo "create-dev-signing-cert: done — \"$NAME\" is ready for npm run package:mac:dev."
