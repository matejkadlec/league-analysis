#!/usr/bin/env bash
# Install checksum-verified actionlint for supported Linux architectures.
set -euo pipefail

readonly actionlint_version='1.7.12'

fail() {
  printf 'actionlint installation failed: %s\n' "$1" >&2
  exit 1
}

if [[ $# -gt 1 ]]; then
  printf 'Usage: %s [absolute-bin-directory]\n' "$0" >&2
  exit 2
fi
destination_directory="${1:-${ACTIONLINT_BIN_DIR:-$HOME/.local/bin}}"
[[ "$destination_directory" == /* ]] || fail 'the destination directory must be absolute.'

case "$(uname -m)" in
  x86_64|amd64)
    architecture='amd64'
    archive_sha256='8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8'
    binary_sha256='c872d6db8c6bf83a8eaa704fc93999f027d55dffbc63b8a6abdccb47df5f4cd4'
    ;;
  aarch64|arm64)
    architecture='arm64'
    archive_sha256='325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6'
    binary_sha256='ac0323433c2853ec3fb978c611430c5b3dc5d43c58d1a1ec031b00ab572beb60'
    ;;
  *)
    fail "unsupported Linux architecture '$(uname -m)'."
    ;;
esac

readonly architecture archive_sha256 binary_sha256
archive="actionlint_${actionlint_version}_linux_${architecture}.tar.gz"
url="https://github.com/rhysd/actionlint/releases/download/v${actionlint_version}/${archive}"

for command_name in curl install sha256sum tar; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required."
done

install -d -m 700 "$destination_directory"
destination_binary="$destination_directory/actionlint"
if [[ -f "$destination_binary" && ! -L "$destination_binary" && -x "$destination_binary" ]] && \
  [[ "$(sha256sum "$destination_binary" | awk '{print $1}')" == "$binary_sha256" ]]; then
  "$destination_binary" -version
  exit 0
fi

temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/league-analysis-actionlint.XXXXXX")"
cleanup() {
  rm -rf -- "$temporary_directory"
}
trap cleanup EXIT
archive_path="$temporary_directory/$archive"
curl --fail --location --retry 3 --silent --show-error --output "$archive_path" "$url" || \
  fail 'unable to download the pinned release archive.'
[[ "$(sha256sum "$archive_path" | awk '{print $1}')" == "$archive_sha256" ]] || \
  fail 'archive checksum verification failed.'
tar --extract --gzip --file "$archive_path" --directory "$temporary_directory" actionlint || \
  fail 'unable to extract the verified archive.'
source_binary="$temporary_directory/actionlint"
[[ -f "$source_binary" && ! -L "$source_binary" && -x "$source_binary" ]] || \
  fail 'the archive did not contain an executable actionlint binary.'
[[ "$(sha256sum "$source_binary" | awk '{print $1}')" == "$binary_sha256" ]] || \
  fail 'binary checksum verification failed.'
install -m 755 "$source_binary" "$destination_binary"
"$destination_binary" -version
