use clap::{Parser, Subcommand};
use orbita_sync::tools::{isolated_restore, online_backup, MigrationLock, BackupOptions, RestoreVerifier};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "orbita-sync-tools")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Backup {
        #[arg(long)]
        source: PathBuf,
        /// Explicit output file. Mutually exclusive with --dest-dir.
        #[arg(long)]
        dest: Option<PathBuf>,
        /// Write a timestamped server-*.sqlite file under this directory.
        #[arg(long)]
        dest_dir: Option<PathBuf>,
    },
    Restore {
        #[arg(long)]
        backup: PathBuf,
        #[arg(long)]
        target: PathBuf,
    },
    MigrationLock {
        #[arg(long)]
        path: PathBuf,
        #[arg(long, default_value_t = 30)]
        hold_secs: u64,
    },
}

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Backup { source, dest, dest_dir } => {
            let dest = match (dest, dest_dir) {
                (Some(dest), None) => dest,
                (None, Some(dir)) => dir.join(orbita_sync::tools::backup_filename("server")),
                _ => return Err("backup needs exactly one of --dest or --dest-dir".into()),
            };
            online_backup(&source, &dest, &BackupOptions::default())?;
        }
        Commands::Restore { backup, target } => {
            let verifier = RestoreVerifier {
                require_integrity_check: true,
                require_schema_migrations: true,
            };
            isolated_restore(&backup, &target, &verifier)?;
        }
        Commands::MigrationLock { path, hold_secs } => {
            let lock = MigrationLock::acquire(&path)?;
            std::thread::sleep(std::time::Duration::from_secs(hold_secs));
            drop(lock);
        }
    }
    Ok(())
}
