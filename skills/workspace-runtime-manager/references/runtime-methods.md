# Runtime installation methods for macOS

Use official publisher sources only. Resolve current URLs from official release metadata when a fixed URL pattern is no longer valid.

## Go

- Download the official macOS archive for the exact version from `go.dev/dl`.
- Apple Silicon artifact convention: `go<version>.darwin-arm64.tar.gz`.
- Intel artifact convention: `go<version>.darwin-amd64.tar.gz`.
- Verify against the SHA-256 published by the Go downloads API/page.
- Extract into `.runtimes/go/<version>` and set `GOROOT` to that directory.
- Set `GOCACHE`, `GOMODCACHE`, and optionally `GOPATH` inside `.runtime-cache/go`.
- Docker fallback after approval: `golang:<version>`.

## Rust

- Use the official `rustup-init` binary with workspace-scoped environment variables.
- Set `RUSTUP_HOME=.runtimes/rust/<channel>/rustup` and `CARGO_HOME=.runtimes/rust/<channel>/cargo` before installation and execution.
- Use `rustup toolchain install <channel> --profile minimal --no-self-update`.
- Pin a release channel such as `1.88.0` when reproducibility is required; permit `stable`, `beta`, or `nightly` only when the user or project explicitly requests a moving channel.
- Do not source or modify the user's global Cargo environment.
- Docker fallback after approval: `rust:<version>`.

## .NET SDK

- Download Microsoft's official `dotnet-install.sh` into `.runtime-cache/dotnet`.
- Run with `--version <version> --install-dir .runtimes/dotnet/<version> --no-path`.
- Set `DOTNET_ROOT` and prepend that exact directory to the scoped `PATH`.
- Set `DOTNET_CLI_HOME=.runtime-cache/dotnet-cli` and `NUGET_PACKAGES=.runtime-cache/nuget`.
- Docker fallback after approval: `mcr.microsoft.com/dotnet/sdk:<version>` or the matching feature-band tag.

## Node.js

- Download the official macOS archive from `nodejs.org/dist/v<version>/`.
- Apple Silicon artifact: `node-v<version>-darwin-arm64.tar.gz`.
- Intel artifact: `node-v<version>-darwin-x64.tar.gz`.
- Verify using the official `SHASUMS256.txt` from the same release directory.
- Extract into `.runtimes/node/<version>` without retaining the archive's extra top-level directory.
- Set npm cache to `.runtime-cache/npm`.
- Docker fallback after approval: `node:<version>`.

## Bun

- Use Bun's official GitHub release artifact for the exact version.
- Apple Silicon archive convention: `bun-darwin-aarch64.zip`.
- Intel archive convention: `bun-darwin-x64.zip`.
- Release URLs generally use tag `bun-v<version>`.
- Verify with official release checksums when published. If unavailable, disclose the limitation before running the binary.
- Place the executable at `.runtimes/bun/<version>/bun`.
- Set `BUN_INSTALL_CACHE_DIR=.runtime-cache/bun`.
- Docker fallback after approval: `oven/bun:<version>`.

## Deno

- Use Deno's official GitHub release artifact for the exact version.
- Apple Silicon archive: `deno-aarch64-apple-darwin.zip`.
- Intel archive: `deno-x86_64-apple-darwin.zip`.
- Release URLs use tag `v<version>`.
- Verify against official checksums when published.
- Place the executable at `.runtimes/deno/<version>/deno`.
- Set `DENO_DIR=.runtime-cache/deno`.
- Docker fallback after approval: `denoland/deno:<version>`.

## uv and Python

- Prefer uv for Python projects unless Conda is explicitly required.
- Download the exact uv release artifact from Astral's official GitHub releases.
- Apple Silicon target: `aarch64-apple-darwin`; Intel target: `x86_64-apple-darwin`.
- Place `uv` and `uvx` under `.runtimes/uv/<version>/bin`.
- Set `UV_CACHE_DIR=.runtime-cache/uv` and `UV_PYTHON_INSTALL_DIR=.runtimes/uv-python`.
- Use `uv python install <python-version>` and `uv venv .venv --python <python-version>`.
- Docker fallback after approval: an exact `ghcr.io/astral-sh/uv` tag or official Python image, depending on project needs.

## Conda / Miniforge

- Use Miniforge from the official conda-forge GitHub releases rather than a global Anaconda installation.
- Apple Silicon installer convention: `Miniforge3-MacOSX-arm64.sh`.
- Intel installer convention: `Miniforge3-MacOSX-x86_64.sh`.
- Install non-interactively with `-b -p .runtimes/conda/<version>`.
- Set `CONDA_PKGS_DIRS=.runtime-cache/conda/pkgs` and create environments inside the workfolder, preferably `.conda-env`.
- Do not run `conda init`.
- Docker fallback after approval: an exact Miniforge image/tag selected from an official conda-forge source.
