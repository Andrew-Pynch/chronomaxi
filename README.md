# Chrono Maxi

Chrono Maxi is a personal time tracking software that helps you monitor and analyze how you spend your time on your computer. It consists of a Rust backend that captures your activity data and a Next.js frontend for visualizing and interacting with the data.

## Features

-   Captures active window titles and timestamps using system-specific libraries.
-   Stores activity data in a SQLite database.
-   Calculates time spent on different activities and programs.
-   Provides a RESTful API for the frontend to fetch activity data.
-   Offers a user-friendly frontend interface to view and analyze time tracking data.
-   Supports different time frames for data visualization (daily, weekly, etc.).

## Prerequisites

-   Rust programming language
-   Node.js and npm (or Yarn/Bun)
-   SQLite
-   xdotool (for Linux)

## Getting Started

1. **Clone the repository:**

```sh
git clone https://github.com/Andrew-Pynch/time-tracker.git
cd time-tracker
```

2. **Install xdotool**

linux

```sh
sudo apt-get xdotool
```

macos

```sh
brew install xdotool
```

3. **Run the tracker / web interface**

```sh
chmod +x run.sh && ./run.sh
```
Run the ./run script (which will start the tracker and the web interface)

Press ctrl+c to stop both.

# Contributing
Make a PR and if its good or cool I will merge it :-) 
