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

1. **GitHub Actions** runs hourly to fetch the latest Europe leaderboard
2. **Git history** stores every snapshot (big brain move tbh)
3. **Extract script** pulls historical data from git commits and crops to top 5000
4. **Static web app** renders it all with vanilla JS (no framework drama)
5. **GitHub Pages** hosts it for free (EZ Clap)

The entire history lives in git commits. We literally turned git into a time-series database. Is this cursed? Maybe. Does it work? Absolutely.

---

## 🏃 Running Locally

```bash
# Install dependencies (turn up, there aren't any lol, it's vanilla JS)

# Extract history from git commits
node scripts/extract-history.js

# Serve the web folder
npx serve web

# Or just open web/index.html in your browser like a caveman
```

---

## 📁 Project Structure

```
├── leaderboard/
│   ├── americas.json        # Americas leaderboard (updated hourly)
│   ├── europe.json          # Europe leaderboard (updated hourly)
│   ├── sea.json             # SE Asia leaderboard (updated hourly)
│   └── china.json           # China leaderboard (updated hourly)
├── scripts/
│   └── extract-history.js   # Extracts snapshots from git history
├── web/
│   ├── index.html           # The one HTML file to rule them all
│   ├── css/styles.css       # Dark mode only (we're not animals)
│   ├── js/
│   │   ├── app.js           # Main coordinator + region switching
│   │   ├── leaderboard.js   # Table rendering + animations
│   │   ├── timeline.js      # Playback controls
│   │   ├── stats.js         # Winners/losers calculations
│   │   └── player-modal.js  # Player detail popup
│   └── data/
│       └── history-*.json   # Generated timeline data per region
└── .github/workflows/       # The automation magic
```

---

## 🧠 Why This Is Actually Genius

- **Zero backend costs** — Git is the database, GitHub Pages is the host
- **Full history preserved** — Every hourly snapshot, forever
- **Smooth animations** — Players visually slide to their new positions
- **Speed-aware animations** — Faster playback = snappier transitions
- **Works offline** — Once loaded, no server needed

Could a human have built this? Sure. Would it have taken 10x longer with 10x more Stack Overflow tabs? Also yes.

---

## 🎮 Dota Leaderboard Pro Tips

- The leaderboard updates hourly-ish
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
