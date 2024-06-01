use backend::{app::TrackerGUI, logger_v3::LoggerV3};
use dotenv::dotenv;
use env_logger;

// #[tokio::main]
// async fn main() -> eframe::Result<()> {
//     env_logger::init(); // Log to stderr (if you run with `RUST_LOG=debug`).
//
//     let logger = LoggerV3::new().await.unwrap();
//
//     let native_options = eframe::NativeOptions {
//         viewport: egui::ViewportBuilder::default()
//             .with_inner_size([400.0, 300.0])
//             .with_min_inner_size([300.0, 220.0])
//             .with_icon(
//                 // NOTE: Adding an icon is optional
//                 eframe::icon_data::from_png_bytes(&include_bytes!("../assets/favicon.png")[..])
//                     .expect("Failed to load icon"),
//             ),
//         ..Default::default()
//     };
//     eframe::run_native(
//         "eframe template",
//         native_options,
//         Box::new(|cc| Box::new(TrackerGUI::new(logger, cc))),
//     )
// }
fn main() {
    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([400.0, 300.0])
            .with_min_inner_size([300.0, 220.0])
            .with_icon(
                // NOTE: Adding an icon is optional
                eframe::icon_data::from_png_bytes(&include_bytes!("../assets/favicon.png")[..])
                    .expect("Failed to load icon"),
            ),
        ..Default::default()
    };
    eframe::run_native(
        "eframe template",
        native_options,
        Box::new(|cc| Box::new(TrackerGUI::new(logger, cc))),
    )
}
