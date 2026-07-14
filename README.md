# 🎮 Dota 2 Leaderboard

A timeline visualization of the Europe Dota 2 leaderboard that tracks players even when they disappear from the leaderboard.

**[🚀 Live Demo](https://lypheo.github.io/dota2-leaderboard)**

---

## ✨ Features

### 📊 Interactive Timeline
Scrub through leaderboard history. Watch players slide up and down with smooth animations as their ranks change.
- ⏯️ Play/Pause with adjustable speed (1x, 2x, 5x)
- ⌨️ Arrow keys and spacebar to navigate (← →)
- 🎚️ Drag the slider to any point in history

### 📈 Biggest Winners & Losers
Track the top climbers and biggest tilters over:
- Last 24 hours
- Last week
- Last month
- Last 6 months

### 🌍 Country Filter
Filter by country to view a country-specific leaderboard.   

### 🎯 Player Details
Search for any player to see their rank history, best/worst rank achieved, and total positions gained/lost over time.

---

## 🛠️ How It Works

1. **GitHub Actions**: Runs daily to fetch the Europe leaderboard.
2. **Daily Snapshots**: Stored as compact JSON files in `data/snapshots/europe/`.
3. **Extract Script**: Builds a columnar history file from all snapshots.
4. **Static Web App**: Renders the history with vanilla JS.
5. **GitHub Pages**: Hosts the static web app.

---

## 🔄 Differences from Pre-Fork

This repository is a fork of the original [maakep/dota2-leaderboard](https://github.com/maakep/dota2-leaderboard). The key differences are:
- **Extended Scope**: Tracks all 5,000 ranks on the leaderboard, instead of being limited to the top 500 players.
- **Region Focus**: Exclusively tracks the Europe region, with all files and data for Americas, China, and Southeast Asia (SEA) removed.
- **Search Players**: Search for any player name to view their rank history, even if they are not on the leaderboard anymore.
- **National Ranks**: Added column to display national ranks.
- **Reworked Storage Format**: Stores historical data in a compact columnar JSON format that aggregates daily snapshots, dramatically reducing download payload size, rather than extracting history from git commits.

---

## 🏃 Running Locally

```bash
# Extract history from snapshot files
node scripts/extract-history.js

# Serve the web folder
npx serve web

# Or just open web/index.html in your browser
```

---

## 📁 Project Structure

```
├── data/
│   └── snapshots/
│       └── europe/
│           ├── 2026-01-01.json    # One file per day (compact format)
│           ├── 2026-01-02.json
│           └── ...
├── scripts/
│   └── extract-history.js         # Builds web history from snapshots
├── web/
│   ├── index.html                 # The main web page
│   ├── css/styles.css             # Main styling stylesheet
│   ├── js/
│   │   ├── app.js                 # Main coordinator
│   │   ├── leaderboard.js         # Table rendering + animations
│   │   ├── timeline.js            # Playback controls
│   │   ├── stats.js               # Winners/losers calculations
│   │   └── player-modal.js        # Player detail popup
│   └── data/
│       └── history-europe.json    # Generated compact columnar history
└── .github/workflows/             # GitHub Actions automation workflows
```

---