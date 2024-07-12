#!/bin/bash

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to handle the Ctrl+C signal
shutdown() {
    echo "Shutting down the tracker and the website..."
    pkill -f "cargo watch"
    pkill -f "cargo run"
    pkill -f "bun run local"
    pkill -f "npm run local"
    exit 0
}

# Register the Ctrl+C signal handler
trap shutdown SIGINT

# Change to the frontend directory
cd frontend

# Set environment to local and update the database
echo "Setting environment to local and updating the database..."
npm run env:local
npm run update:db

# Change back to the root directory
cd ..

# Change to the tracker directory
cd tracker

# Check if the -dev flag is passed
if [ "$1" = "-dev" ]; then
    echo "Starting the tracker in development mode using cargo watch..."
    cargo watch -x run &
    TRACKER_PID=$!
else
    echo "Starting the tracker..."
    cargo run &
    TRACKER_PID=$!
fi

# Change to the frontend directory
cd ../frontend

# Check if bun is installed
if command_exists bun; then
    echo "Bun is installed. Starting the website using Bun..."
    bun run local &
    WEBSITE_PID=$!
else
    echo "Bun is not installed. Falling back to npm..."
    if command_exists npm; then
        echo "Starting the website using npm..."
        npm run local &
        WEBSITE_PID=$!
    else
        echo "Neither Bun nor npm is installed. Please install one of them to run the website."
        exit 1
    fi
fi

# Wait for the tracker and website processes to complete or be interrupted
wait $TRACKER_PID $WEBSITE_PID
