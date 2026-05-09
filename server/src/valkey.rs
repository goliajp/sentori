use anyhow::Context;
use redis::Client;
use redis::aio::ConnectionManager;

/// Open a Valkey connection manager. The manager handles reconnects
/// transparently for the lifetime of the process.
pub async fn connect(url: &str) -> anyhow::Result<ConnectionManager> {
    let client = Client::open(url).context("opening valkey client")?;
    let conn = ConnectionManager::new(client)
        .await
        .context("connecting valkey")?;
    Ok(conn)
}
