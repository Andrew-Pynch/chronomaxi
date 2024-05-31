use backend::config::Configuration;
use backend::log::Log;
use backend::logger_v2::LoggerV2;
use dotenv::dotenv;
use std::thread;
use std::time::Duration;

const THREE_MINUTES_OF_LOGS: usize = 1800;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();
    let db = backend::db::DbConnection::new().await?;

    println!("Starting keypress and program usage tracker...");

    let mut config = Configuration::from_env();

    // verify api key
    let is_valid_api_key = db.is_api_key_valid(&config.api_key).await?;
    if !is_valid_api_key {
        println!("Invalid API key");
        return Ok(());
    }

    let user_id = db.get_user_from_api_key(&config.api_key).await?;
    if user_id.is_empty() {
        println!("No user found for API key");
        return Ok(());
    } else {
        println!("User found: {}", user_id);
        config.set_user_id(user_id);

        let mut logger = LoggerV2::new(config);

        loop {
            // we capture data in 100ms time slices
            thread::sleep(Duration::from_millis(100));

            logger.capture();

            if !logger.is_idle() {
                if logger.log_count() % 100 == 0 {
                    logger.print_last();
                    println!("Logs captured: {}", logger.log_count());
                }

                // Break the loop if the log count reaches 100
                if logger.log_count() >= THREE_MINUTES_OF_LOGS {
                    let logs: Vec<Log> = logger.flush();
                    db.bulk_insert_logs(&logs).await?;
                    logger.clear();
                }
            }
        }
    }
}
