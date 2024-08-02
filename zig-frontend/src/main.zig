// main.zig
const std = @import("std");
const rl = @import("raylib");
const Constants = @import("constants.zig").Constants;

pub const Gui = struct {
    allocator: std.mem.Allocator,
    camera: rl.Camera2D,

    pub fn init() !Gui {
        var gpa = std.heap.GeneralPurposeAllocator(.{}){};
        const allocator = gpa.allocator();

        rl.initWindow(
            Constants.SCREEN_WIDTH,
            Constants.SCREEN_HEIGHT,
            @as([*:0]const u8, Constants.PROJECT_NAME),
        );
        rl.setTargetFPS(Constants.TARGET_FPS);

        // Set up a 2D camera for a top-down view
        const camera = rl.Camera2D{
            .offset = rl.Vector2.init(@as(f32, @floatFromInt(Constants.SCREEN_WIDTH)) / 2, @as(f32, @floatFromInt(Constants.SCREEN_HEIGHT)) / 2),
            .target = rl.Vector2.init(0, 0),
            .rotation = 0,
            .zoom = 1,
        };

        return Gui{
            .allocator = allocator,
            .camera = camera,
        };
    }

    pub fn deinit(self: *Gui) void {
        rl.closeWindow();
        _ = self;
    }

    pub fn run(self: *Gui) !void {
        while (!rl.windowShouldClose()) {
            try self.update();
            self.draw();
        }
    }

    pub fn update(self: *Gui) !void {
        // Update logic here
        _ = self;
    }

    pub fn draw(self: *Gui) void {
        rl.beginDrawing();
        defer rl.endDrawing();

        rl.clearBackground(rl.Color.black);

        // Begin 2D mode with the camera
        rl.beginMode2D(self.camera);

        // Draw your GUI elements here
        rl.drawText("Hello, 2D World!", 10, 10, 20, rl.Color.black);

        rl.endMode2D();
    }
};

pub fn main() !void {
    var gui = try Gui.init();
    defer gui.deinit();
    try gui.run();
}
