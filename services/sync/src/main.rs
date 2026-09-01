use anyhow::Result;
use clap::{Parser, Subcommand};
use orbita_sync::config::Config;

#[derive(Parser)]
#[command(name = "orbita-sync", about = "Orbita Journal/Health sync API")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Run HTTP sync server (default)
    Serve,
    /// Print effective configuration
    Config,
    /// Admin: create enrollment invite (local bootstrap only)
    Admin {
        #[command(subcommand)]
        command: AdminCommands,
    },
}

#[derive(Subcommand)]
enum AdminCommands {
    /// Create a one-time enrollment invite for an account
    CreateInvite {
        account_id: String,
        #[arg(long, default_value_t = 24)]
        ttl_hours: i64,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command.unwrap_or(Commands::Serve) {
        Commands::Serve => {
            let config = Config::load()?;
            orbita_sync::run_server(config).await?;
        }
        Commands::Config => {
            let config = Config::load()?;
            println!("listen_addr={}", config.listen_addr);
            println!("state_dir={}", config.state_dir.display());
            println!("backup_dir={}", config.backup_dir.display());
            println!("db_path={}", config.db_path.display());
            println!("log_level={}", config.log_level);
        }
        Commands::Admin { command } => match command {
            AdminCommands::CreateInvite {
                account_id,
                ttl_hours,
            } => {
                let config = Config::load()?;
                config.validate_startup()?;
                let db = orbita_sync::db::Database::open(&config)?;
                let (code, invite) =
                    orbita_sync::auth::enrollment::create_invite(&db, &account_id, ttl_hours)?;
                println!("invite_code={code}");
                println!("expires_at_utc={}", invite.expires_at_utc);
                println!("account_id={}", invite.account_id);
            }
        },
    }
    Ok(())
}
