#!/bin/bash

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to handle the Ctrl+C signal
shutdown() {
    echo "Shutting down the tracker and the website..."
    pkill -f "cargo run"
    pkill -f "bun run local"
    pkill -f "npm run local"
    exit 0
}

# Register the Ctrl+C signal handler
trap shutdown SIGINT

# Change to the tracker directory
cd tracker

# Run the tracker using cargo
echo "Starting the tracker..."
cargo run &
TRACKER_PID=$!

# Change to the frontend directory
cd ../frontend

# Check if bun is installed
if command_exists bun; then
    echo "Bun is installed. Installing dependencies and running the website using Bun..."
    bun install
    bun run local &
    WEBSITE_PID=$!
else
    echo "Bun is not installed. Falling back to npm..."
    if command_exists npm; then
        echo "Installing dependencies and running the website using npm..."
        npm install
        npm run local &
        WEBSITE_PID=$!
    else
        echo "Neither Bun nor npm is installed. Please install one of them to run the website."
        exit 1
    fi
fi

# Wait for the tracker and website processes to complete or be interrupted
wait $TRACKER_PID $WEBSITE_PID
