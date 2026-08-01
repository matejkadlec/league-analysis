#!/usr/bin/env bash
# Install the pinned ShellCheck binary after archive and binary verification.
set -euo pipefail

readonly shellcheck_version='0.10.0'
readonly release_directory="shellcheck-v${shellcheck_version}"

fail() {
  printf 'ShellCheck installation failed: %s\n' "$1" >&2
  exit 1
}

if [[ $# -gt 1 ]]; then
  printf 'Usage: %s [absolute-bin-directory]\n' "$0" >&2
  exit 2
fi

destination_directory="${1:-${SHELLCHECK_BIN_DIR:-$HOME/.local/bin}}"
[[ "$destination_directory" == /* ]] || fail 'the destination directory must be absolute.'

case "$(uname -m)" in
  x86_64|amd64)
    platform='linux.x86_64'
    archive_sha256='6c881ab0698e4e6ea235245f22832860544f17ba386442fe7e9d629f8cbedf87'
    binary_sha256='f35ae15a4677945428bdfe61ccc297490d89dd1e544cc06317102637638c6deb'
    ;;
  aarch64|arm64)
    platform='linux.aarch64'
    archive_sha256='324a7e89de8fa2aed0d0c28f3dab59cf84c6d74264022c00c22af665ed1a09bb'
    binary_sha256='4111c09318d10b93653a42179381273f31061b34987978346fbd19a6e81a74c3'
    ;;
  *)
    fail "unsupported Linux architecture '$(uname -m)'."
    ;;
esac

readonly platform archive_sha256 binary_sha256
archive="shellcheck-v${shellcheck_version}.${platform}.tar.xz"
url="https://github.com/koalaman/shellcheck/releases/download/v${shellcheck_version}/${archive}"

for command_name in curl install sha256sum tar; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required."
done

install -d -m 700 "$destination_directory"
destination_binary="$destination_directory/shellcheck"
if [[ -f "$destination_binary" && ! -L "$destination_binary" && -x "$destination_binary" ]] && \
  [[ "$(sha256sum "$destination_binary" | awk '{print $1}')" == "$binary_sha256" ]]; then
  "$destination_binary" --version
  exit 0
fi

temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/league-analysis-shellcheck.XXXXXX")"
cleanup() {
  rm -rf -- "$temporary_directory"
}
trap cleanup EXIT

archive_path="$temporary_directory/$archive"
curl --fail --location --retry 3 --silent --show-error --output "$archive_path" "$url" || \
  fail 'unable to download the pinned release archive.'
[[ "$(sha256sum "$archive_path" | awk '{print $1}')" == "$archive_sha256" ]] || \
  fail 'archive checksum verification failed.'
tar --extract --xz --file "$archive_path" --directory "$temporary_directory" \
  "$release_directory/shellcheck" || fail 'unable to extract the verified archive.'
source_binary="$temporary_directory/$release_directory/shellcheck"
[[ -f "$source_binary" && ! -L "$source_binary" && -x "$source_binary" ]] || \
  fail 'the archive did not contain an executable ShellCheck binary.'
[[ "$(sha256sum "$source_binary" | awk '{print $1}')" == "$binary_sha256" ]] || \
  fail 'binary checksum verification failed.'
install -m 755 "$source_binary" "$destination_binary"
"$destination_binary" --version
