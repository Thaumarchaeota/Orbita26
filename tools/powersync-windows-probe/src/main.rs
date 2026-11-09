#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // No external path, credential or endpoint input is accepted.
    anyhow::ensure!(std::env::args_os().len() == 1, "This probe accepts no arguments");
    powersync_windows_probe::run().await
}
