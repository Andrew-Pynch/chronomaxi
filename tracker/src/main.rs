use backend::logger_v4::LoggerV4;
use dotenv::dotenv;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();

    let mut logger = LoggerV4::new().await?;
    logger.run().await?;

    return Ok(());
}
