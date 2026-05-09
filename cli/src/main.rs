use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use walkdir::WalkDir;

const DEFAULT_INGEST_URL: &str = "https://ingest.sentori.golia.jp";

#[derive(Parser)]
#[command(
    name = "sentori-cli",
    version,
    about = "Sentori CLI — upload source maps and other release artifacts"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Upload release artifacts (source maps for now; dSYM / ProGuard later).
    Upload {
        #[command(subcommand)]
        kind: UploadKind,
    },
}

#[derive(Subcommand)]
enum UploadKind {
    /// Upload `.js` and `.js.map` files for a release.
    Sourcemap {
        /// Release name, e.g. `myapp@1.2.3+456`
        #[arg(long)]
        release: String,
        /// Bearer token. Defaults to `SENTORI_TOKEN` env var.
        #[arg(long)]
        token: Option<String>,
        /// Ingest URL base. Defaults to `SENTORI_INGEST_URL` env var,
        /// or `https://ingest.sentori.golia.jp`.
        #[arg(long = "ingest-url")]
        ingest_url: Option<String>,
        /// Files or directories. Directories are walked recursively for
        /// `.js` and `.js.map`.
        files: Vec<PathBuf>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Upload { kind } => match kind {
            UploadKind::Sourcemap {
                release,
                token,
                ingest_url,
                files,
            } => upload_sourcemap(release, token, ingest_url, files).await,
        },
    }
}

async fn upload_sourcemap(
    release: String,
    token: Option<String>,
    ingest_url: Option<String>,
    files: Vec<PathBuf>,
) -> Result<()> {
    let token = token
        .or_else(|| std::env::var("SENTORI_TOKEN").ok())
        .context("token: pass --token or set SENTORI_TOKEN")?;

    let base = ingest_url
        .or_else(|| std::env::var("SENTORI_INGEST_URL").ok())
        .unwrap_or_else(|| DEFAULT_INGEST_URL.to_string());

    let collected = collect_files(&files)?;
    if collected.is_empty() {
        anyhow::bail!("no .js or .js.map files found in the given paths");
    }

    println!(
        "Uploading {} file(s) to release {release} via {base}...",
        collected.len()
    );

    let url = format!(
        "{}/admin/api/releases/{}/sourcemaps",
        base.trim_end_matches('/'),
        urlencoding(&release)
    );

    let client = reqwest::Client::new();
    let mut form = reqwest::multipart::Form::new();
    for path in &collected {
        let data = tokio::fs::read(path)
            .await
            .with_context(|| format!("reading {}", path.display()))?;
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_string();
        let part = reqwest::multipart::Part::bytes(data).file_name(name.clone());
        form = form.part(name, part);
    }

    let resp = client
        .post(&url)
        .bearer_auth(&token)
        .multipart(form)
        .send()
        .await?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        anyhow::bail!("upload failed: {status} {body}");
    }

    println!("OK ({status}): {body}");
    Ok(())
}

fn collect_files(paths: &[PathBuf]) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for p in paths {
        if p.is_dir() {
            for entry in WalkDir::new(p).into_iter().filter_map(|e| e.ok()) {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }
                let s = path.to_string_lossy();
                if s.ends_with(".js") || s.ends_with(".js.map") {
                    out.push(path.to_path_buf());
                }
            }
        } else if p.is_file() {
            out.push(p.clone());
        } else {
            anyhow::bail!("path does not exist or is not a file/dir: {}", p.display());
        }
    }
    Ok(out)
}

fn urlencoding(s: &str) -> String {
    // Just escape what we need for the release segment (`@`, `+`, `/`, ` `).
    s.chars()
        .flat_map(|c| match c {
            '@' => "%40".chars().collect::<Vec<_>>(),
            '+' => "%2B".chars().collect::<Vec<_>>(),
            '/' => "%2F".chars().collect::<Vec<_>>(),
            ' ' => "%20".chars().collect::<Vec<_>>(),
            other => vec![other],
        })
        .collect()
}
