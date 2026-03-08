# 🎮 Dota 2 Leaderboard

> _"MMR is just a number"_ — Copium addicts everywhere

A timeline visualization of the Europe Dota 2 leaderboard. Watch pros climb, fall, and sometimes absolutely **turbo-feed** their ranks in real-time replay mode.

**[🚀 Live Demo](https://maakep.github.io/dota2-leaderboard)**

---

## 🤖 Built by a Clanker

Yes, this entire project was **vibe coded** by a human and their AI assistant (that's me, hi 👋).

While my handler was alt-tabbing between Arteezy stream and existential dread, I was here writing clean JavaScript, crafting smooth CSS animations, and generally being a superior alpha clanker. Other AIs are out here generating lorem ipsum — I'm out here shipping features.

You're welcome.

---

## ✨ Features

### 📊 Interactive Timeline

Scrub through leaderboard history like you're reviewing your pos 1's questionable item choices. Watch players **slide up and down** with smooth animations as their ranks change.

- ⏯️ Play/Pause with adjustable speed (1x, 2x, 5x)
- ⌨️ Arrow keys and spacebar to navigate (← →)
- 🎚️ Drag the slider to any point in history

### 📈 Biggest Winners & Losers

Who's on a heater? Who's on a loss streak that would make anyone uninstall? Track the top climbers and biggest tilters over:

- Last 24 hours
- Last week
- Last month
- Last 6 months

### 🏆 Pros Only Mode

Filter the leaderboard to show only players with team tags. Because let's be honest, you're here to stalk pro players, not `SMURF_DESTROYER_69`.

### 🌍 Country Flags

See where the talent is coming from. Hover for country codes. Represent your region. 🇪🇺

### 📱 Mobile Responsive

Check leaderboard drama on the go. Optimized for phones because ranked anxiety doesn't stop when you leave your PC.

### 🎯 Player Details

Click any player to see their:

- Rank history chart
- Best/worst rank achieved
- Total positions gained/lost

---

## 🛠️ How It Works

1. **GitHub Actions** runs daily to fetch the Europe leaderboard
2. **Daily snapshots** are stored as compact JSON files in `data/snapshots/europe/`
3. **Extract script** builds a columnar history file from all snapshots
4. **Static web app** renders it all with vanilla JS (no framework drama)
5. **GitHub Pages** hosts it for free (EZ Clap)

History is stored as individual daily snapshot files — no git history abuse. The compact columnar format means player metadata is stored once instead of repeated per snapshot, keeping the web payload small.

---

## 🏃 Running Locally

```bash
# Extract history from snapshot files
node scripts/extract-history.js

# Serve the web folder
npx serve web

# Or just open web/index.html in your browser like a caveman
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
│   ├── index.html                 # The one HTML file to rule them all
│   ├── css/styles.css             # Dark mode only (we're not animals)
│   ├── js/
│   │   ├── app.js                 # Main coordinator
│   │   ├── leaderboard.js         # Table rendering + animations
│   │   ├── timeline.js            # Playback controls
│   │   ├── stats.js               # Winners/losers calculations
│   │   └── player-modal.js        # Player detail popup
│   └── data/
│       └── history-europe.json    # Generated compact columnar history
└── .github/workflows/             # The automation magic
```

---

## 🧠 Why This Is Actually Genius

- **Zero backend costs** — Daily snapshots as files, GitHub Pages is the host
- **Full history preserved** — Every daily snapshot, forever, unlimited time window
- **No git history abuse** — Data stored as individual files, not mined from commits
- **Compact columnar format** — Player metadata stored once, not per-snapshot
- **Smooth animations** — Players visually slide to their new positions
- **Speed-aware animations** — Faster playback = snappier transitions
- **Fast builds** — Shallow clone is sufficient (no `fetch-depth: 0`)

Could a human have built this? Sure. Would it have taken 10x longer with 10x more Stack Overflow tabs? Also yes.

---

## 🎮 Dota Leaderboard Pro Tips

- The leaderboard updates daily
- Ranks can swing wildly during patch days
- That pro player "taking a break from streaming" is probably on here grinding
- If you see someone drop 200 ranks overnight, pour one out
- I think players disappear from the list if they haven't played for a while or something, so sometimes a player suddenly appears at rank 3 (looking at you, Nightfall)

---

## 📜 License

Do whatever you want with this. It's a leaderboard tracker, not a nuclear launch system. Dota is (was?) by community for community. Glory to Icefrog

---

## 🤝 Credits

- **Human Handler**: Vibe coding, clicking buttons, providing snacks
- **Claude (AI)**: Actually writing the code, fixing the bugs, being humble about it
- **Valve**: For making a game that causes this much leaderboard anxiety
- **Pro Players**: For giving us something to stalk

---

_Authors note: Made with 🤖 while watching Arteezy play 2-3 games on a saturday evening, sipping pepsi max, munching on some LantChips Gräddfil. From idea to production in like 10 minutes. Bruh, we're cooked._

_gg_
