#!/bin/sh
# Standalone GitHub release installer, adapted from ar4ft/agentgrep/scripts/install.sh.
# Keep the program in main so a truncated pipe cannot start an installation.
main() {
    set -eu
    umask 022
    oxc_prefix=${OXC_INSTALL_DIR:-"$HOME/.oxc"}
    oxc_version=${OXC_VERSION:-latest}
    oxc_channel=published
    oxc_modify_path=true
    oxc_tmp=
    oxc_locked=false
    fail() { printf 'oxc installer: %s\n' "$*" >&2; exit 1; }
    download() {
        curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
            --tlsv1.2 --connect-timeout 15 --max-time 300 --retry 2 "$1" -o "$2"
    }
    cleanup() {
        if [ -n "$oxc_tmp" ]; then rm -rf "$oxc_tmp"; fi
        if [ "$oxc_locked" = true ]; then rmdir "$oxc_prefix/.install-lock"; fi
    }
    quote() { printf "'"; printf '%s' "$1" | sed "s/'/'\\\\''/g"; printf "'"; }
    sha256() {
        if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
        else shasum -a 256 "$1" | awk '{print $1}'; fi
    }
    # Parse only top-level release fields, ignoring nested assets and release-body
    # strings. Works with a release object or array and compact/pretty API JSON;
    # no jq, Python, eval, or downloaded code is needed for metadata parsing.
    releases() {
        LC_ALL=C fold -b -w 4096 "$1" | LC_ALL=C awk '
          function scalar() {
            if (depth == 1 && key == "prerelease") pre = token
            if (depth == 1 && key == "draft") draft = token
            token = ""
          }
          {
            for (i=1; i<=length($0); i++) {
              c=substr($0,i,1)
              if (str) {
                if (esc) { token=token "\\" c; esc=0 }
                else if (c == "\\") esc=1
                else if (c == "\"") {
                  str=0
                  if (value) { if (depth == 1 && key == "tag_name") tag=token }
                  else pending=token
                  token=""
                } else token=token c
                continue
              }
              if (c == "\"") { str=1; token=""; esc=0 }
              else if (c == ":") { key=pending; pending=""; value=1; token="" }
              else if (c == "{") { depth++; value=0; key=""; if (depth==1) {tag="";pre="";draft=""} }
              else if (c == "}") {
                scalar()
                if (depth==1 && tag!="") print tag "|" pre "|" draft
                depth--; value=0; key=""
              }
              else if (c == "," || c == "[" || c == "]") { scalar(); value=0; key="" }
              else if (value && c !~ /[[:space:]]/) token=token c
            }
          }
          END { if (str || depth != 0) exit 1 }
        '
    }

    while [ "$#" -gt 0 ]; do
        case "$1" in
            --version|--prefix)
                [ "$#" -ge 2 ] || fail "$1 requires a value"
                case "$1" in --version) oxc_version=$2;; --prefix) oxc_prefix=$2;; esac
                shift 2;;
            --stable) oxc_channel=stable; shift;;
            --no-modify-path) oxc_modify_path=false; shift;;
            --help|-h)
                cat <<'HELP'
Usage: install.sh [--version VERSION] [--stable] [--prefix ABSOLUTE_PATH] [--no-modify-path]

Install or update the standalone opencodex binary from ar4ft/opencodex.
Commands: oxc, ocx, opencodex. Default prefix: ~/.oxc (OXC_INSTALL_DIR).
Default version: newest published release, including prereleases.
--stable selects a production release; --version pins a bare or v-prefixed tag.
OXC_VERSION also selects a version. No sudo, Node, npm or Bun installation needed.
Rerun this installer or use oxc update to update. Updates keep the previous binary.
HELP
                return 0;;
            *) fail "unknown option: $1";;
        esac
    done
    case "$oxc_prefix" in /*) ;; *) fail 'installation prefix must be absolute';; esac
    case "$oxc_prefix" in /|*:*|*'
'*|*"$(printf '\r')"*) fail 'invalid installation prefix';; esac
    for oxc_command in curl awk fold sed grep mktemp uname; do
        command -v "$oxc_command" >/dev/null 2>&1 || fail "$oxc_command is required"
    done
    command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || fail 'sha256sum or shasum is required'
    oxc_os=$(uname -s)
    oxc_arch=$(uname -m)
    case "$oxc_os:$oxc_arch" in
        Darwin:arm64|Darwin:aarch64) oxc_target=darwin-arm64;;
        Darwin:x86_64)
            if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then oxc_target=darwin-arm64
            else oxc_target=darwin-x64; fi;;
        Linux:x86_64|Linux:amd64) oxc_target=linux-x64;;
        Linux:aarch64|Linux:arm64) oxc_target=linux-arm64;;
        *) fail "unsupported platform: $oxc_os/$oxc_arch (Linux and macOS x64/arm64 are available)";;
    esac
    oxc_asset=opencodex-$oxc_target
    if [ "$oxc_version" != latest ]; then
        printf '%s\n' "$oxc_version" | LC_ALL=C grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$' || fail 'invalid version'
    fi
    mkdir -p "$oxc_prefix"
    [ ! -L "$oxc_prefix/.install-lock" ] || fail 'unexpected lock symlink'
    mkdir "$oxc_prefix/.install-lock" 2>/dev/null || fail "another installer is running; see $oxc_prefix/.install-lock"
    oxc_locked=true
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM HUP
    oxc_tmp=$(mktemp -d "$oxc_prefix/.install.XXXXXXXX")
    oxc_api=https://api.github.com/repos/ar4ft/opencodex/releases
    if [ "$oxc_version" = latest ]; then
        if [ "$oxc_channel" = stable ]; then oxc_metadata_url=$oxc_api/latest
        else oxc_metadata_url=$oxc_api'?per_page=20'; fi
    else oxc_metadata_url=$oxc_api/tags/$oxc_version; fi
    oxc_metadata_ok=false
    if download "$oxc_metadata_url" "$oxc_tmp/release.json"; then oxc_metadata_ok=true
    elif [ "$oxc_version" != latest ]; then
        case "$oxc_version" in v*) oxc_alternate=${oxc_version#v};; *) oxc_alternate=v$oxc_version;; esac
        if download "$oxc_api/tags/$oxc_alternate" "$oxc_tmp/release.json"; then oxc_metadata_ok=true; fi
    fi
    if [ "$oxc_metadata_ok" = true ]; then
        releases "$oxc_tmp/release.json" > "$oxc_tmp/releases" || fail 'invalid GitHub release metadata'
        oxc_release=$(awk -F '|' '$3 == "false" && ($2 == "true" || $2 == "false") {print; exit}' "$oxc_tmp/releases")
    else
        [ "$oxc_channel" != stable ] || fail 'production release metadata unavailable; refusing to weaken --stable'
        if [ "$oxc_version" != latest ]; then
            # A caller-selected tag needs no feed discovery. Probe both tag conventions
            # so old pinned releases remain usable during an API outage.
            oxc_release=
            for oxc_candidate in "$oxc_version" "$oxc_alternate"; do
                if download "https://github.com/ar4ft/opencodex/releases/download/$oxc_candidate/checksums.txt" "$oxc_tmp/pinned-checksum"; then
                    oxc_release=$oxc_candidate'|unknown|false'
                    break
                fi
            done
            [ -n "$oxc_release" ] || fail 'pinned release assets unavailable'
        else
            download https://github.com/ar4ft/opencodex/releases.atom "$oxc_tmp/releases.atom" || fail 'GitHub API and release feed unavailable'
            sed -n 's@^[[:space:]]*<link rel="alternate" type="text/html" href="https://github.com/ar4ft/opencodex/releases/tag/\([^" ]*\)"/>[[:space:]]*$@\1@p' "$oxc_tmp/releases.atom" | awk 'NR<=20 {print}' > "$oxc_tmp/feed-tags"
            oxc_release=
            while IFS= read -r oxc_feed_tag; do
                printf '%s\n' "$oxc_feed_tag" | LC_ALL=C grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$' || continue
                [ "$oxc_version" = latest ] || [ "${oxc_feed_tag#v}" = "${oxc_version#v}" ] || continue
                if download "https://github.com/ar4ft/opencodex/releases/download/$oxc_feed_tag/checksums.txt" "$oxc_tmp/feed-checksum" 2> "$oxc_tmp/feed-error"; then
                    oxc_release=$oxc_feed_tag'|unknown|false'
                    break
                fi
            done < "$oxc_tmp/feed-tags"
            [ -n "$oxc_release" ] || fail 'no matching release with standalone assets found'
        fi
    fi
    [ -n "$oxc_release" ] || fail 'no published release found'
    oxc_tag=${oxc_release%%|*}
    printf '%s\n' "$oxc_tag" | LC_ALL=C grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$' || fail 'invalid release tag'
    [ "$oxc_version" = latest ] || [ "${oxc_tag#v}" = "${oxc_version#v}" ] || fail 'release metadata version mismatch'
    case "$oxc_release" in
        *'|true|false')
            [ "$oxc_channel" != stable ] || fail 'requested release is a prerelease'
            printf 'Installing prerelease %s.\n' "$oxc_tag" >&2;;
        *'|unknown|false') printf 'Installing %s without API release classification.\n' "$oxc_tag" >&2;;
    esac
    oxc_url=https://github.com/ar4ft/opencodex/releases/download/$oxc_tag
    printf 'Downloading opencodex %s for %s\n' "$oxc_tag" "$oxc_target"
    download "$oxc_url/$oxc_asset" "$oxc_tmp/opencodex-next" || fail 'binary download failed'
    download "$oxc_url/checksums.txt" "$oxc_tmp/checksums" || fail 'checksum download failed'
    oxc_expected=$(awk -v name="$oxc_asset" 'NF==2 && $2==name && length($1)==64 && $1 !~ /[^0-9a-f]/ {print $1; count++} END {if(count!=1) exit 1}' "$oxc_tmp/checksums") || fail 'invalid checksum file'
    [ "$(sha256 "$oxc_tmp/opencodex-next")" = "$oxc_expected" ] || fail 'binary SHA-256 checksum mismatch; installation unchanged'
    chmod 755 "$oxc_tmp/opencodex-next"
    "$oxc_tmp/opencodex-next" help > "$oxc_tmp/help" || fail 'binary platform/startup check failed; installation unchanged'
    for oxc_dir in bin lib; do
        [ ! -L "$oxc_prefix/$oxc_dir" ] || fail "unexpected $oxc_dir symlink"
        mkdir -p "$oxc_prefix/$oxc_dir"
    done
    for oxc_output in lib/opencodex lib/opencodex.previous install-receipt env bin/oxc bin/ocx bin/opencodex; do
        [ ! -L "$oxc_prefix/$oxc_output" ] || fail "unexpected $oxc_output symlink"
        [ ! -e "$oxc_prefix/$oxc_output" ] || [ -f "$oxc_prefix/$oxc_output" ] || fail "unexpected $oxc_output directory"
        if [ -e "$oxc_prefix/$oxc_output" ]; then
            [ -f "$oxc_prefix/install-receipt" ] || fail 'refusing to overwrite an unmanaged installation'
        fi
    done
    # All command names use the same wrapper so standalone updates cannot select npm.
    {
        printf '#!/bin/sh\nset -eu\noxc_prefix='; quote "$oxc_prefix"; printf '\n'
        cat <<'WRAPPER'
if [ "${1:-}" = update ]; then
    shift
    # Help must not download or modify anything.
    for oxc_arg in "$@"; do
        case "$oxc_arg" in --help|-h)
            printf 'Usage: oxc update [--version VERSION] [--stable] [--no-modify-path]\n'
            exit 0;; esac
    done
    # The updater always owns this prefix; reject attempts to silently switch it.
    for oxc_arg in "$@"; do
        case "$oxc_arg" in --prefix|--prefix=*) printf 'oxc update: use install.sh to change prefix\n' >&2; exit 1;; esac
    done
    oxc_update_tmp=$(mktemp -d "$oxc_prefix/.update.XXXXXXXX")
    trap 'rm -rf "$oxc_update_tmp"' EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM HUP
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
        --tlsv1.2 --connect-timeout 15 --max-time 300 --retry 2 \
        https://raw.githubusercontent.com/ar4ft/opencodex/refs/heads/main/scripts/install.sh \
        -o "$oxc_update_tmp/install.sh"
    OXC_VERSION=latest sh "$oxc_update_tmp/install.sh" --prefix "$oxc_prefix" "$@"
    exit $?
fi
exec "$oxc_prefix/lib/opencodex" "$@"
WRAPPER
    } > "$oxc_tmp/launcher"
    chmod 755 "$oxc_tmp/launcher"
    printf 'version=%s\ntarget=%s\nbinary_sha256=%s\n' "$oxc_tag" "$oxc_target" "$oxc_expected" > "$oxc_tmp/receipt"
    oxc_path_line="export PATH=$(quote "$oxc_prefix/bin"):\"\$PATH\""
    printf '%s\n' "$oxc_path_line" > "$oxc_tmp/env"
    if [ -f "$oxc_prefix/lib/opencodex" ]; then
        cp -p "$oxc_prefix/lib/opencodex" "$oxc_tmp/opencodex-previous"
        mv -f "$oxc_tmp/opencodex-previous" "$oxc_prefix/lib/opencodex.previous"
    fi
    # Same-filesystem staging makes binary replacement atomic on Linux/macOS.
    mv -f "$oxc_tmp/opencodex-next" "$oxc_prefix/lib/opencodex"
    for oxc_alias in oxc ocx opencodex; do
        cp "$oxc_tmp/launcher" "$oxc_tmp/$oxc_alias"
        mv -f "$oxc_tmp/$oxc_alias" "$oxc_prefix/bin/$oxc_alias"
    done
    mv -f "$oxc_tmp/receipt" "$oxc_prefix/install-receipt"
    mv -f "$oxc_tmp/env" "$oxc_prefix/env"
    if [ "$oxc_modify_path" = true ]; then
        case "$oxc_os:${SHELL:-}" in
            Darwin:*/zsh) oxc_profile=$HOME/.zprofile;;
            Darwin:*/bash) oxc_profile=$HOME/.bash_profile;;
            *:*/zsh) oxc_profile=$HOME/.zshrc;;
            *:*/bash) oxc_profile=$HOME/.bashrc;;
            *) oxc_profile=$HOME/.profile;;
        esac
        oxc_source_line=". $(quote "$oxc_prefix/env") # oxc installer"
        if ! grep -Fqx "$oxc_source_line" "$oxc_profile" 2>/dev/null; then
            printf '\n%s\n' "$oxc_source_line" >> "$oxc_profile" || fail "installed, but cannot update $oxc_profile; source $oxc_prefix/env manually"
        fi
        printf 'PATH configured in %s. Open a new terminal, or run:\n  . ' "$oxc_profile"
        quote "$oxc_prefix/env"; printf '\n'
    fi
    printf 'Installed %s/bin/oxc (%s). Aliases: ocx, opencodex.\n' "$oxc_prefix" "$oxc_tag"
    printf 'Run oxc init to set up, or oxc restart if a proxy is already running.\n'
}
main "$@"
