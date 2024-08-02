const rl = @import("raylib");

pub const Constants = struct {
    pub const SCREEN_WIDTH: i32 = 800;
    pub const SCREEN_HEIGHT: i32 = 450;
    pub const PROJECT_NAME: [*:0]const u8 = "chronomaxi-gui";

    pub const MAX_COLUMNS: i32 = 20;
    pub const PLAY_SPACE_DIMENSIONS: rl.Vector2 = rl.Vector2{ .x = 100, .y = 100 };

    pub const FPS_COORDINATES: rl.Vector2 = rl.Vector2{ .x = 10, .y = 10 };
    pub const TARGET_FPS: i32 = 240;
    pub const HOTKEY_GRID_WIDTH: i32 = 200;
    pub const HOTKEY_GRID_HEIGHT: i32 = 200;

    pub const RANDOM_SEED: u64 = 42;

    pub const PLAYER_START_X: i32 = 100;
    pub const PLAYER_START_Y: i32 = 100;
    pub const PLAYER_START_MATTER: i32 = 100;
    pub const PLAYER_START_ENERGY: i32 = 100;

    pub const MAX_UNIT_COUNT: usize = 1000;
    pub const MIN_DISTANCE: f32 = 10.0;

    pub const UPDATE_INTERVAL: f32 = 1.0 / 60.0;

    pub const MOVEMENT_SPEED: f32 = 5.0;
    pub const DEFAULT_SIZE: f32 = 10.0;

    pub const CAMERA_MOVEMENT_SPEED: f32 = 0.5;
    pub const EDGE_PAN_BORDER: i32 = 50;

    pub const DAMPENING_FACTOR: f32 = 0.99;
};
