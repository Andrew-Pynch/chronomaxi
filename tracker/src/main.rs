use backend::ingest;
use backend::logger_v4::LoggerV4;
use dotenv::dotenv;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();

    let mut logger = LoggerV4::new().await?;

    // Decoupled spool-to-Convex flusher: its own task, its own spool
    // connection, never blocks capture on network.
    let flusher_config = logger.config.clone();
    tokio::spawn(async move {
        ingest::run_flusher(flusher_config).await;
    });

    logger.run().await?;

    Ok(())
}
