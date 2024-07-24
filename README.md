# Chrono Maxi

Chrono Maxi is a personal time tracking software that helps you monitor and analyze how you spend your time on your computer. It consists of a Rust backend that captures your activity data and a Next.js frontend for visualizing and interacting with the data.

Use it to generate stats like the real time stats that chronomaxi powers on my personal website, [andrewpynch.com](https://andrewpynch.com)
![image](https://github.com/user-attachments/assets/8380c59d-b8c7-4653-8481-f3b973fb49c4)
![image](https://github.com/user-attachments/assets/85b4a781-2718-408a-9afe-88d1a5a32d2c)

## Features

- Captures active window titles and timestamps using system-specific libraries.
- Stores activity data in a SQLite database.
- Calculates time spent on different activities and programs.
- Provides a RESTful API for the frontend to fetch activity data.
- Offers a user-friendly frontend interface to view and analyze time tracking data.
- Supports different time frames for data visualization (daily, weekly, etc.).

## Prerequisites

- Rust programming language
- Node.js and npm (or Yarn/Bun)
- SQLite
- xdotool (for Linux)

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

### First Terminal (web interface)

```sh
cd frontend
cp .env.example .env.local_secrets
bun run local
```

### Second Terminal (tracker)

```sh
cd tracker
cargo run
```

# Contributing

Make a PR and if its good or cool I will merge it :-)
