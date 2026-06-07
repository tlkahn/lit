use std::{env, fs, path::Path, process::Command};

fn main() {
    set_git_version();
    ensure_placeholders();
    build_tauri();

    println!("cargo:rerun-if-env-changed=LIT_LICENSE_VERIFYING_KEY_B64");

    let profile = env::var("PROFILE").unwrap();
    if profile != "debug" {
        embed_prod_key(
            "LIT_LICENSE_VERIFYING_KEY_B64",
            "prod_license_verifying.bin",
        );
    }
}

/// App-store builds exclude the updater capability because the plugin isn't registered.
fn build_tauri() {
    let capabilities_pattern = if env::var_os("CARGO_FEATURE_APP_STORE").is_some() {
        "./capabilities/*"
    } else {
        "./capabilities/**/*"
    };
    println!("cargo:rerun-if-changed=capabilities");
    let attributes =
        tauri_build::Attributes::new().capabilities_path_pattern(capabilities_pattern);
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}

fn set_git_version() {
    // Single source of truth: on release/CI builds, scripts/set-version.sh
    // patches the package version into Cargo.toml, tauri.conf.json, and
    // package.json in lockstep (asserted by scripts/tests/release.bats). When
    // that has happened, CARGO_PKG_VERSION is the real semver, so we mirror it
    // into LIT_GIT_VERSION — this guarantees the runtime-displayed version
    // (About dialog / get_app_info) equals the bundle metadata
    // (CFBundleShortVersionString / DMG filename) by construction, with no
    // possibility of silent divergence.
    let pkg_version = env::var("CARGO_PKG_VERSION").unwrap();
    if pkg_version != "0.0.0" {
        println!("cargo:rustc-env=LIT_GIT_VERSION={pkg_version}");
        // No rerun directives needed: the version is fixed by set-version.sh, not derived from git.
        return;
    }

    // Dev fallback: the version is the unpatched placeholder, so derive the
    // nearest tag from git, defaulting back to the package version if git is
    // unavailable. Use --abbrev=0 (nearest tag only, no `-N-gSHA` suffix) to
    // match build-release.yml's "Sync version from git tag" step, which uses
    // `git describe --tags --abbrev=0` on non-release runs. Keeping the flags
    // identical guarantees the About dialog and bundle metadata never show
    // differing strings for the same off-tag build.
    let tag = Command::new("git")
        .args(["describe", "--tags", "--abbrev=0"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok());

    let version = resolve_dev_version(tag.as_deref(), &pkg_version);

    if tag.is_none() {
        println!("cargo:warning=no git tags found, using version {version}");
    }

    println!("cargo:rustc-env=LIT_GIT_VERSION={version}");

    emit_git_rerun_directives();
}

/// Pure helper for the dev-fallback version string. Given the raw stdout of
/// `git describe --tags --abbrev=0` (if it ran) and the package version, return
/// the version to surface as `LIT_GIT_VERSION`.
///
/// When a tag is present it is cleaned (trimmed, leading `v` stripped) and used
/// verbatim. When no usable tag exists (git absent, shallow clone with no tags,
/// empty output) we must NOT silently surface the bare `pkg_version`: in dev
/// builds that is the unpatched `0.0.0` placeholder, which would render as a
/// fake "Lit v0.0.0" release in the About dialog. Instead we append a `-dev`
/// suffix so the fallback is clearly labelled (e.g. `0.0.0-dev`) and can never
/// be mistaken for a real release.
///
/// Format contract (`LIT_GIT_VERSION`): both branches are semver-clean. The
/// caller feeds `git describe --tags --abbrev=0` (nearest tag only) — NOT the
/// `--always` / default form, which would yield a non-semver `X.Y.Z-N-g<sha>`
/// off-tag string. So the tag branch is a plain `X.Y.Z` and the fallback branch
/// is the `X.Y.Z-dev` pre-release; neither ever carries a `-g<sha>` commit
/// suffix. The value is currently display/IPC only (menu.rs, get_app_info), but
/// a future consumer may semver-parse it, so this invariant is pinned by
/// `tests/resolve_dev_version.rs::resolved_version_never_carries_git_sha_suffix`.
// SYNC:begin:resolve_dev_version
fn resolve_dev_version(tag: Option<&str>, pkg_version: &str) -> String {
    let cleaned = tag
        .map(|t| t.trim())
        .map(|t| t.strip_prefix('v').unwrap_or(t))
        .filter(|t| !t.is_empty());

    match cleaned {
        Some(t) => t.to_string(),
        None => format!("{pkg_version}-dev"),
    }
}
// SYNC:end:resolve_dev_version

/// Tell Cargo to re-run this build script when the checked-out commit or any
/// tag changes. Without these, the `cargo:rerun-if-env-changed=...` directive
/// in `main` switches Cargo into explicit-input mode, so it would never notice
/// new commits/tags and `LIT_GIT_VERSION` would stay stale until `cargo clean`.
///
/// Resolves paths via `git rev-parse` so it is worktree-aware: in a linked
/// worktree `HEAD` lives in the per-worktree git dir while tags and
/// `packed-refs` live in the shared common dir. When git is absent (packaged
/// source tarball) nothing is emitted and we don't panic.
fn emit_git_rerun_directives() {
    for path in git_rerun_paths(resolve_git_path, |p| Path::new(p).exists()) {
        println!("cargo:rerun-if-changed={path}");
    }
}

/// Resolve a git-relative path (e.g. "HEAD", "refs/tags", "packed-refs") to an
/// absolute filesystem path, returning `None` if git is unavailable or the
/// command fails. `HEAD` is resolved against the per-worktree git dir; the
/// others against the shared common dir so they work from linked worktrees.
// SYNC:begin:resolve_git_path
fn resolve_git_path(rel: &str) -> Option<String> {
    let arg = if rel == "HEAD" {
        "--git-path"
    } else {
        "--git-common-dir"
    };
    let mut args = vec!["rev-parse", "--path-format=absolute", arg];
    if rel == "HEAD" {
        args.push(rel);
    }
    let out = Command::new("git").args(&args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let base = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if base.is_empty() {
        return None;
    }
    if rel == "HEAD" {
        Some(base)
    } else {
        Some(Path::new(&base).join(rel).to_string_lossy().into_owned())
    }
}
// SYNC:end:resolve_git_path

/// Pure helper: given a resolver for git-relative paths and an existence
/// predicate, return the absolute paths that should be emitted as
/// `cargo:rerun-if-changed` directives. Only existing paths are returned —
/// emitting a directive for a missing path would force Cargo to re-run on every
/// build. Returns an empty list when git can't be resolved at all.
// SYNC:begin:git_rerun_paths
fn git_rerun_paths<R, E>(resolve: R, exists: E) -> Vec<String>
where
    R: Fn(&str) -> Option<String>,
    E: Fn(&str) -> bool,
{
    ["HEAD", "refs/tags", "packed-refs"]
        .iter()
        .filter_map(|rel| resolve(rel))
        .filter(|p| exists(p))
        .collect()
}
// SYNC:end:git_rerun_paths

fn ensure_placeholders() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));

    let triple = env::var("TARGET").unwrap_or_else(|_| {
        env::var("CARGO_CFG_TARGET_ARCH")
            .map(|arch| format!("{arch}-apple-darwin"))
            .unwrap_or_else(|_| "aarch64-apple-darwin".into())
    });

    ensure_placeholders_in(manifest, &triple);
}

/// Create placeholder files for externalBin and resources so that
/// `tauri_build::build()` doesn't fail in worktrees or fresh checkouts
/// where gitignored artifacts haven't been fetched yet.
// SYNC:begin:ensure_placeholders_in
fn ensure_placeholders_in(base: &Path, triple: &str) {
    let academic = base.join("resources").join("academic");
    let csl_dir = academic.join("csl");

    let placeholders = [
        base.join("binaries").join(format!("lit-cli-{triple}")),
        base.join("libs").join("libpdfium.dylib"),
        academic.join("lit-reference.docx"),
        csl_dir.join("apa.csl"),
        csl_dir.join("chicago-author-date.csl"),
        csl_dir.join("ieee.csl"),
        csl_dir.join("vancouver.csl"),
        csl_dir.join("mla.csl"),
        csl_dir.join("acm-sig-proceedings.csl"),
        csl_dir.join("nature.csl"),
        csl_dir.join("harvard-cite-them-right.csl"),
        csl_dir.join("american-medical-association.csl"),
        csl_dir.join("springer-basic-author-date.csl"),
    ];

    for path in &placeholders {
        if !path.exists() {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(path, []);
        }
    }
}
// SYNC:end:ensure_placeholders_in

fn embed_prod_key(env_var: &str, filename: &str) {
    let b64 = env::var(env_var)
        .unwrap_or_else(|_| panic!("{env_var} must be set for release builds"));

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .unwrap_or_else(|e| panic!("{env_var}: invalid base64: {e}"));

    assert!(
        bytes.len() == 32,
        "{env_var}: expected 32 bytes, got {}",
        bytes.len()
    );

    let out_dir = env::var("OUT_DIR").unwrap();
    fs::write(Path::new(&out_dir).join(filename), &bytes).unwrap();
}
