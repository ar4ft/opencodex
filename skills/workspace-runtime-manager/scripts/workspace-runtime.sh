#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
log() { printf '%s\n' "$*" >&2; }
need() { command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"; }

PLATFORM="${WSRT_PLATFORM:-$(uname -s)}"
[[ "$PLATFORM" == "Darwin" ]] || fail "this skill currently supports macOS only"
ROOT="${WORKSPACE_ROOT:-$PWD}"
RUNTIMES="$ROOT/.runtimes"
CACHE="$ROOT/.runtime-cache"
mkdir -p "$RUNTIMES" "$CACHE"
ARCH_RAW="${WSRT_ARCH:-$(uname -m)}"
case "$ARCH_RAW" in arm64) ARCH=arm64 ;; x86_64) ARCH=x86_64 ;; *) fail "unsupported macOS architecture: $ARCH_RAW" ;; esac

usage() {
  cat <<'TXT'
Usage:
  workspace-runtime.sh status <runtime>
  workspace-runtime.sh ensure <runtime> <version>
  workspace-runtime.sh env <runtime> <version>
  workspace-runtime.sh exec <runtime> <version> -- <command> [args...]
Runtimes: go rust dotnet node bun deno uv conda
TXT
}

runtime_dir() { printf '%s/%s/%s' "$RUNTIMES" "$1" "$2"; }
record_version() {
  local runtime=$1 version=$2 file="$ROOT/.runtime-versions" tmp
  tmp="$(mktemp)"
  if [[ -f "$file" ]]; then grep -v "^${runtime}=" "$file" > "$tmp" || true; fi
  printf '%s=%s\n' "$runtime" "$version" >> "$tmp"
  mv "$tmp" "$file"
}

download() { need curl; curl --fail --location --retry 3 --output "$2" "$1"; }
verify_shasums_line() {
  local sums=$1 filename=$2 dir=$3 expected actual
  expected="$(awk -v f="$filename" '$2==f || $2=="*"f {print $1; exit}' "$sums")"
  [[ -n "$expected" ]] || fail "checksum not found for $filename"
  actual="$(shasum -a 256 "$dir/$filename" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] || fail "SHA-256 mismatch for $filename"
}

install_go() {
  local v=$1 dest file url meta expected actual
  dest="$(runtime_dir go "$v")"; [[ -x "$dest/bin/go" ]] && return
  need tar; need shasum
  case "$ARCH" in arm64) file="go${v}.darwin-arm64.tar.gz" ;; x86_64) file="go${v}.darwin-amd64.tar.gz" ;; esac
  url="https://go.dev/dl/$file"; mkdir -p "$CACHE/go" "$dest"
  download "$url" "$CACHE/go/$file"
  meta="$CACHE/go/$file.json"; download "https://go.dev/dl/?mode=json&include=all" "$meta"
  expected="$(python3 - "$meta" "$file" <<'PY'
import json,sys
for rel in json.load(open(sys.argv[1])):
    for f in rel.get('files',[]):
        if f.get('filename') == sys.argv[2]: print(f.get('sha256','')); raise SystemExit
PY
)"
  [[ -n "$expected" ]] || fail "official Go checksum not found"
  actual="$(shasum -a 256 "$CACHE/go/$file" | awk '{print $1}')"; [[ "$actual" == "$expected" ]] || fail "Go checksum mismatch"
  rm -rf "$dest"; mkdir -p "$dest"; tar -xzf "$CACHE/go/$file" -C "$dest" --strip-components=1
}

install_node() {
  local v=$1 dest platform file base
  dest="$(runtime_dir node "$v")"; [[ -x "$dest/bin/node" ]] && return
  need tar; need shasum
  [[ "$ARCH" == arm64 ]] && platform=arm64 || platform=x64
  file="node-v${v}-darwin-${platform}.tar.gz"; base="https://nodejs.org/dist/v${v}"
  mkdir -p "$CACHE/node"; download "$base/$file" "$CACHE/node/$file"; download "$base/SHASUMS256.txt" "$CACHE/node/SHASUMS256-$v.txt"
  verify_shasums_line "$CACHE/node/SHASUMS256-$v.txt" "$file" "$CACHE/node"
  rm -rf "$dest"; mkdir -p "$dest"; tar -xzf "$CACHE/node/$file" -C "$dest" --strip-components=1
}

install_dotnet() {
  local v=$1 dest script
  dest="$(runtime_dir dotnet "$v")"; [[ -x "$dest/dotnet" ]] && return
  script="$CACHE/dotnet/dotnet-install.sh"; mkdir -p "$(dirname "$script")" "$dest"
  [[ -f "$script" ]] || download "https://dot.net/v1/dotnet-install.sh" "$script"
  bash "$script" --version "$v" --install-dir "$dest" --no-path
}

install_rust() {
  local v=$1 dest rustup_arch file url
  dest="$(runtime_dir rust "$v")"; [[ -x "$dest/cargo/bin/rustc" ]] && return
  [[ "$ARCH" == arm64 ]] && rustup_arch=aarch64-apple-darwin || rustup_arch=x86_64-apple-darwin
  file="rustup-init-$rustup_arch"; url="https://static.rust-lang.org/rustup/dist/$rustup_arch/rustup-init"
  mkdir -p "$CACHE/rust" "$dest/rustup" "$dest/cargo"; download "$url" "$CACHE/rust/$file"; chmod +x "$CACHE/rust/$file"
  RUSTUP_HOME="$dest/rustup" CARGO_HOME="$dest/cargo" "$CACHE/rust/$file" -y --no-modify-path --profile minimal --default-toolchain "$v"
}

install_bun() {
  local v=$1 dest artifact url zip bin
  dest="$(runtime_dir bun "$v")"; [[ -x "$dest/bun" ]] && return
  need unzip
  [[ "$ARCH" == arm64 ]] && artifact=bun-darwin-aarch64 || artifact=bun-darwin-x64
  url="https://github.com/oven-sh/bun/releases/download/bun-v${v}/${artifact}.zip"; zip="$CACHE/bun/${artifact}-${v}.zip"
  mkdir -p "$CACHE/bun" "$dest"; download "$url" "$zip"; rm -rf "$dest"; mkdir -p "$dest"; unzip -q "$zip" -d "$dest.tmp"
  bin="$(find "$dest.tmp" -type f -name bun -perm -111 | head -1)"; [[ -n "$bin" ]] || fail "Bun executable not found in archive"
  mv "$bin" "$dest/bun"; rm -rf "$dest.tmp"; chmod +x "$dest/bun"
  log "warning: Bun release checksum was not verified; inspect official release assets before sensitive use"
}

install_deno() {
  local v=$1 dest artifact url zip
  dest="$(runtime_dir deno "$v")"; [[ -x "$dest/deno" ]] && return
  need unzip
  [[ "$ARCH" == arm64 ]] && artifact=deno-aarch64-apple-darwin || artifact=deno-x86_64-apple-darwin
  url="https://github.com/denoland/deno/releases/download/v${v}/${artifact}.zip"; zip="$CACHE/deno/${artifact}-${v}.zip"
  mkdir -p "$CACHE/deno"; download "$url" "$zip"; rm -rf "$dest"; mkdir -p "$dest"; unzip -q "$zip" -d "$dest"; chmod +x "$dest/deno"
  log "warning: Deno release checksum was not verified; inspect official release assets before sensitive use"
}

install_uv() {
  local v=$1 dest target artifact url tgz bin
  dest="$(runtime_dir uv "$v")"; [[ -x "$dest/bin/uv" ]] && return
  need tar
  [[ "$ARCH" == arm64 ]] && target=aarch64-apple-darwin || target=x86_64-apple-darwin
  artifact="uv-${target}.tar.gz"; url="https://github.com/astral-sh/uv/releases/download/${v}/${artifact}"; tgz="$CACHE/uv/${artifact%.tar.gz}-${v}.tar.gz"
  mkdir -p "$CACHE/uv" "$dest/bin"; download "$url" "$tgz"; rm -rf "$dest"; mkdir -p "$dest/bin" "$dest.tmp"; tar -xzf "$tgz" -C "$dest.tmp"
  bin="$(find "$dest.tmp" -type f -name uv -perm -111 | head -1)"; [[ -n "$bin" ]] || fail "uv executable not found"
  cp "$bin" "$dest/bin/uv"; [[ -x "$(dirname "$bin")/uvx" ]] && cp "$(dirname "$bin")/uvx" "$dest/bin/uvx" || true
  rm -rf "$dest.tmp"; chmod +x "$dest/bin/uv" "$dest/bin/uvx" 2>/dev/null || true
  log "warning: uv release checksum was not verified; inspect official release assets before sensitive use"
}

install_conda() {
  local v=$1 dest artifact url installer
  dest="$(runtime_dir conda "$v")"; [[ -x "$dest/bin/conda" ]] && return
  [[ "$ARCH" == arm64 ]] && artifact=Miniforge3-MacOSX-arm64.sh || artifact=Miniforge3-MacOSX-x86_64.sh
  url="https://github.com/conda-forge/miniforge/releases/download/${v}/${artifact}"; installer="$CACHE/conda/${artifact%.sh}-${v}.sh"
  mkdir -p "$CACHE/conda"; download "$url" "$installer"; rm -rf "$dest"; bash "$installer" -b -p "$dest"
  log "warning: Miniforge installer checksum was not verified; inspect official release assets before sensitive use"
}

ensure_runtime() {
  local r=$1 v=$2
  case "$r" in
    go) install_go "$v" ;; rust) install_rust "$v" ;; dotnet) install_dotnet "$v" ;; node) install_node "$v" ;;
    bun) install_bun "$v" ;; deno) install_deno "$v" ;; uv) install_uv "$v" ;; conda) install_conda "$v" ;;
    *) fail "unsupported runtime: $r" ;;
  esac
  record_version "$r" "$v"
}

env_for() {
  local r=$1 v=$2 d; d="$(runtime_dir "$r" "$v")"
  case "$r" in
    go) printf 'export GOROOT=%q\nexport GOCACHE=%q\nexport GOMODCACHE=%q\nexport GOPATH=%q\nexport PATH=%q:$PATH\n' "$d" "$CACHE/go/build" "$CACHE/go/mod" "$CACHE/go/path" "$d/bin" ;;
    rust) printf 'export RUSTUP_HOME=%q\nexport CARGO_HOME=%q\nexport PATH=%q:$PATH\n' "$d/rustup" "$d/cargo" "$d/cargo/bin" ;;
    dotnet) printf 'export DOTNET_ROOT=%q\nexport DOTNET_CLI_HOME=%q\nexport NUGET_PACKAGES=%q\nexport PATH=%q:$PATH\n' "$d" "$CACHE/dotnet-cli" "$CACHE/nuget" "$d" ;;
    node) printf 'export npm_config_cache=%q\nexport PATH=%q:$PATH\n' "$CACHE/npm" "$d/bin" ;;
    bun) printf 'export BUN_INSTALL_CACHE_DIR=%q\nexport PATH=%q:$PATH\n' "$CACHE/bun-cache" "$d" ;;
    deno) printf 'export DENO_DIR=%q\nexport PATH=%q:$PATH\n' "$CACHE/deno-cache" "$d" ;;
    uv) printf 'export UV_CACHE_DIR=%q\nexport UV_PYTHON_INSTALL_DIR=%q\nexport PATH=%q:$PATH\n' "$CACHE/uv-cache" "$RUNTIMES/uv-python" "$d/bin" ;;
    conda) printf 'export CONDA_PKGS_DIRS=%q\nexport PATH=%q:$PATH\n' "$CACHE/conda/pkgs" "$d/bin" ;;
    *) fail "unsupported runtime: $r" ;;
  esac
}

cmd=${1:-}; case "$cmd" in
  status) [[ $# -eq 2 ]] || { usage; exit 2; }; r=$2; [[ -d "$RUNTIMES/$r" ]] && find "$RUNTIMES/$r" -mindepth 1 -maxdepth 1 -type d -print || true ;;
  ensure) [[ $# -eq 3 ]] || { usage; exit 2; }; ensure_runtime "$2" "$3"; eval "$(env_for "$2" "$3")"; case "$2" in go) go version;; rust) rustc --version && cargo --version;; dotnet) dotnet --info;; node) node --version && npm --version;; bun) bun --version;; deno) deno --version;; uv) uv --version;; conda) conda --version;; esac ;;
  env) [[ $# -eq 3 ]] || { usage; exit 2; }; env_for "$2" "$3" ;;
  exec) [[ $# -ge 5 && "$4" == -- ]] || { usage; exit 2; }; r=$2; v=$3; shift 4; ensure_runtime "$r" "$v"; eval "$(env_for "$r" "$v")"; exec "$@" ;;
  *) usage; exit 2 ;;
esac
