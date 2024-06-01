use crate::logger_v3::LoggerV3;
use std::{cell::RefCell, ffi::c_float, future::IntoFuture};
use tokio::runtime::Runtime;

pub struct TrackerGUI {
    logger: Option<RefCell<LoggerV3>>,
    root_is_running: bool,
}

impl Default for TrackerGUI {
    fn default() -> Self {
        Self {
            logger: None,
            root_is_running: false,
        }
    }
}

impl TrackerGUI {
    /// Called once before the first frame.
    pub fn new(logger: LoggerV3, _cc: &eframe::CreationContext<'_>) -> Self {
        Self {
            logger: Some(RefCell::new(logger)),
            root_is_running: true,
            ..Default::default()
        }
    }
}

impl eframe::App for TrackerGUI {
    /// Called by the frame work to save state before shutdown.
    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        // eframe::set_value(storage, eframe::APP_KEY, self);
    }

    /// Called each time the UI needs repainting, which may be many times per second.
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        egui::TopBottomPanel::top("top_panel").show(ctx, |ui| {
            // ... (top panel code remains the same)
        });

        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("chronomaxi");
            if let Some(logger) = &self.logger {
                if ui.button("Start Tracking").clicked() {
                    logger.borrow_mut().start();
                }
                if ui.button("Stop Tracking").clicked() {
                    logger.borrow_mut().stop();
                }
            }
            ui.separator();
            ui.hyperlink("https://github.com/Andrew-Pynch/chronomaxi");
            ui.with_layout(egui::Layout::bottom_up(egui::Align::LEFT), |ui| {
                powered_by_egui_and_eframe(ui);
                egui::warn_if_debug_build(ui);
            });
        });
    }
}

fn powered_by_egui_and_eframe(ui: &mut egui::Ui) {
    ui.horizontal(|ui| {
        ui.spacing_mut().item_spacing.x = 0.0;
        ui.label("Powered by ");
        ui.hyperlink_to("egui", "https://github.com/emilk/egui");
        ui.label(" and ");
        ui.hyperlink_to(
            "eframe",
            "https://github.com/emilk/egui/tree/master/crates/eframe",
        );
        ui.label(".");
    });
}
