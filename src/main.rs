use backend::logger_v3::LoggerV3;
use dotenv::dotenv;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();

    let mut logger = LoggerV3::new().await?;
    logger.run().await?;

    return Ok(());
}
