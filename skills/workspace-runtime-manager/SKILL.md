---
name: workspace-runtime-manager
description: Manage project-local programming runtimes on macOS for Go, Rust, .NET SDK, Node.js, Bun, Deno, Python through uv, and Conda/Miniforge. Use when a coding task needs one of these runtimes installed, selected, verified, or executed without a system-wide installation; when a repository needs reproducible runtime versions under its own workfolder; or when native setup fails and a Docker fallback may be proposed. Always prefer a self-contained workspace installation and require explicit user approval before using Docker.
---

# Workspace Runtime Manager

Create and use language runtimes inside the current project rather than modifying macOS globally. Keep all runtimes, caches, environments, and generated activation files within the workfolder unless the user explicitly requests otherwise.

## Required policy

1. Treat the repository root or current workfolder as `WORKSPACE_ROOT`.
2. Store runtime binaries under `WORKSPACE_ROOT/.runtimes/<runtime>/`.
3. Store runtime downloads and caches under `WORKSPACE_ROOT/.runtime-cache/`.
4. Store Python virtual environments under `WORKSPACE_ROOT/.venv/` unless the project already defines another local location.
5. Never use `sudo`.
6. Never modify `/usr/local`, `/opt/homebrew`, `/Library`, `/Applications`, or another global location.
7. Never edit `~/.zshrc`, `~/.bashrc`, `~/.profile`, or another persistent shell profile.
8. Never install with Homebrew, MacPorts, or a graphical package installer unless the user explicitly requests that method.
9. Prefer an already-compatible runtime in `.runtimes` before downloading anything.
10. Require an exact version whenever practical. If the user says `latest`, resolve the current stable version from the runtime's official source before installing and record the resolved version.
11. Verify downloads using an official checksum or signature when the publisher provides one. If no verification material is available, disclose that before execution.
12. Do not silently fall back to Docker. Explain why the native installation failed and ask for explicit approval before creating or running a container.
13. Report the selected runtime, version, architecture, installation path, verification result, and whether execution is native or containerized.

## Workflow

### 1. Detect project and platform

Run:

```bash
pwd
uname -s
uname -m
sw_vers -productVersion
```

Support only macOS (`Darwin`) in this version. Map architectures as follows:

- `arm64` to Apple Silicon artifacts (`arm64`, `aarch64`, or runtime-specific equivalent).
- `x86_64` to Intel artifacts (`x64`, `amd64`, or runtime-specific equivalent).

Stop rather than guessing when the artifact naming or architecture is unclear.

### 2. Determine version

Check project-native version declarations before asking or choosing:

- Go: `go.mod`, `.go-version`, `mise.toml`, `.tool-versions`
- Rust: `rust-toolchain.toml`, `rust-toolchain`, `Cargo.toml`
- .NET: `global.json`, project target frameworks
- Node: `.nvmrc`, `.node-version`, `package.json` `engines`, Volta settings
- Bun: `package.json` `packageManager`, `bun.lock` or `bun.lockb`
- Deno: `deno.json`, `deno.jsonc`, lockfile metadata
- Python/uv: `.python-version`, `pyproject.toml`, `uv.lock`
- Conda: `environment.yml`, `environment.yaml`, `conda-lock.yml`

Prefer the most explicit project pin. Explain conflicts before choosing.

### 3. Use the bundled manager

Use `scripts/workspace-runtime.sh` for supported operations:

```bash
bash scripts/workspace-runtime.sh status <runtime>
bash scripts/workspace-runtime.sh ensure <runtime> <version>
bash scripts/workspace-runtime.sh exec <runtime> <version> -- <command> [args...]
bash scripts/workspace-runtime.sh env <runtime> <version>
```

Supported runtime identifiers:

```text
go rust dotnet node bun deno uv conda
```

The manager must be run from the target workfolder, not from the skill directory. Copy the script into the workfolder under `scripts/` when persistent project tooling is useful; otherwise invoke the bundled script with the target workfolder as the current directory.

### 4. Verify after installation

Run the runtime's native version command:

```text
go       go version
rust     rustc --version && cargo --version
dotnet   dotnet --info
node     node --version && npm --version
bun      bun --version
deno     deno --version
uv       uv --version
conda    conda --version
```

Also verify that `command -v` resolves inside the workfolder's `.runtimes` path during the scoped command.

### 5. Execute with scoped environment

Prefer `workspace-runtime.sh exec` so environment changes affect only the child process. Do not require activation or global `PATH` changes.

Examples:

```bash
bash scripts/workspace-runtime.sh exec node 24.4.1 -- node app.js
bash scripts/workspace-runtime.sh exec dotnet 9.0.203 -- dotnet build
bash scripts/workspace-runtime.sh exec go 1.24.5 -- go test ./...
bash scripts/workspace-runtime.sh exec rust stable -- cargo test
bash scripts/workspace-runtime.sh exec bun 1.2.19 -- bun test
bash scripts/workspace-runtime.sh exec deno 2.4.2 -- deno test
bash scripts/workspace-runtime.sh exec uv 0.8.4 -- uv run pytest
```

For Python, use uv first unless the repository explicitly requires Conda. Create `.venv` inside the workfolder and keep uv-managed Python downloads inside `.runtimes/uv-python` by setting `UV_PYTHON_INSTALL_DIR`.

### 6. Handle native failure

Do not invoke Docker automatically. Provide:

- The native command that failed.
- The relevant error.
- The likely cause.
- The proposed official Docker image and exact tag.
- The project directory and ports that would be mounted or exposed.
- A direct approval question.

Only after explicit approval, generate a minimal Dockerfile or `docker run --rm` command. Mount only the workfolder and specific cache directories. Never mount the entire home directory, Docker socket, SSH directory, cloud credentials, or Keychain paths unless separately required and approved.

## Runtime-specific rules

Read `references/runtime-methods.md` before installing or troubleshooting a runtime. It defines artifact sources, local environment variables, version conventions, and Docker fallback patterns.

## Project metadata

After a successful installation, write or update `.runtime-versions` in the workfolder:

```text
node=24.4.1
bun=1.2.19
```

Do not overwrite unrelated entries. Add these generated paths to `.gitignore` when appropriate:

```text
.runtimes/
.runtime-cache/
.venv/
```

Do not alter `.gitignore` without showing the intended change when the repository is user-maintained.

## Output requirements

Conclude runtime work with a compact report:

```text
Runtime: Node.js
Version: 24.4.1
Mode: native workspace
Path: <workspace>/.runtimes/node/24.4.1
Architecture: arm64
Verification: official SHA-256 checksum matched
Command: scripts/workspace-runtime.sh exec node 24.4.1 -- node app.js
Docker used: no
```
