# Releasing

How to cut a new Windows + Linux release. Versioning is manual — the release
workflow does not derive or inject a version from the git tag.

## Steps

1. **Bump the version** in both places, kept in sync by hand:
   - `src-tauri/tauri.conf.json` → `"version"`
   - `package.json` → `"version"`
2. **Commit** the version bump.
   ```bash
   git add src-tauri/tauri.conf.json package.json
   git commit -m "chore: bump version to X.Y.Z"
   git push origin main
   ```
3. **Tag and push the tag** — this is what triggers the release build:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
4. **Wait for CI** (~15–20 min). Watch progress under the repo's *Actions* tab
   — the `Release` workflow (`.github/workflows/release.yml`) runs Windows and
   Linux builds in parallel via `tauri-apps/tauri-action`.
5. **Review the draft release** on GitHub (*Releases* tab). CI creates it as a
   **draft** — nothing is public yet. Check the attached files, edit the notes
   if needed.
6. **Publish** the draft yourself when it looks right. This manual step is
   intentional — nothing ships automatically.

## What gets built

| Platform | File | Notes |
|---|---|---|
| Windows | `*.msi` | Standard installer, adds Start Menu entry |
| Windows | `limes-ce-editor-portable-vX.Y.Z-windows.zip` | Unzip and run, no install |
| Linux | `*.deb` | Debian / Ubuntu only |
| Linux | `*.AppImage` | Everyone else (Fedora, Arch, RHEL, etc.) — `chmod +x`, run directly, no packaging integration needed |

`.rpm` is deliberately not built — it wouldn't actually solve the "other
distros" problem, since rpm-based distros disagree with each other on
dependency naming (Fedora vs RHEL vs openSUSE). AppImage already covers that
gap correctly.

## First time / troubleshooting

This workflow has been reviewed but not yet run end-to-end against a real
tag push — the first real release is effectively the live test. If something
platform-specific breaks, check the Actions log for that OS's job; the two
platforms build independently (`fail-fast: false`), so one failing doesn't
block the other.

Relevant files:
- `.github/workflows/release.yml` — the release workflow itself
- `.github/workflows/ci.yml` — the separate build/lint/test workflow that
  runs on every push (not release-related, but easy to confuse with this one)
- `src-tauri/tauri.conf.json` — `bundle.targets: "all"` lets each platform
  build whatever's valid for it; the release workflow further narrows this
  per-OS via `--bundles msi` / `--bundles deb,appimage`
