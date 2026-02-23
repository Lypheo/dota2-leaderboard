/**
 * Leaderboard display and animation module
 */

const Leaderboard = {
  container: null,
  currentPlayers: [],
  previousSnapshot: null,
  animationSpeed: 1, // Timeline speed (1, 2, or 5)
  currentSnapshot: null, // Store current snapshot for re-rendering on filter change

  /**
   * Get animation durations based on timeline speed
   */
  getAnimationDurations() {
    // Slower on 1x, faster on 5x
    const durations = {
      1: { slide: 0.6, flash: 1500 },
      2: { slide: 0.4, flash: 1000 },
      5: { slide: 0.15, flash: 350 },
    };
    return durations[this.animationSpeed] || durations[1];
  },

  /**
   * Set the animation speed (called by Timeline)
   */
  setAnimationSpeed(speed) {
    this.animationSpeed = speed;
    // Update CSS custom property for flash animation duration
    const { flash } = this.getAnimationDurations();
    document.documentElement.style.setProperty(
      "--flash-duration",
      `${flash}ms`,
    );
  },

  /**
   * Initialize the leaderboard
   */
  init() {
    this.container = document.getElementById("leaderboard-list");
  },

  /**
   * Render the leaderboard for a given snapshot
   * @param {Object} snapshot - The snapshot to render
   * @param {Object} previousSnapshot - The previous snapshot for comparison
   * @param {boolean} animate - Whether to animate changes
   */
  render(snapshot, previousSnapshot = null, animate = true) {
    // Store snapshots for re-rendering on filter change
    this.currentSnapshot = snapshot;
    if (previousSnapshot) {
      this.previousSnapshot = previousSnapshot;
    }

    // Apply global filters
    let players = snapshot.players;
    let prevPlayers = previousSnapshot ? previousSnapshot.players : [];

    if (window.App) {
      if (App.selectedCountry) {
        const country = App.selectedCountry.toLowerCase();
        players = players.filter(
          (p) => p.country && p.country.toLowerCase() === country,
        );
        prevPlayers = prevPlayers.filter(
          (p) => p.country && p.country.toLowerCase() === country,
        );
      }
      if (App.prosOnly) {
        players = players.filter((p) => p.team_tag && p.team_tag.trim() !== "");
        prevPlayers = prevPlayers.filter(
          (p) => p.team_tag && p.team_tag.trim() !== "",
        );
      }
    }

    // Build a map of previous ranks for comparison
    const prevRanks = {};
    for (const player of prevPlayers) {
      const playerId = Stats.getPlayerId(player);
      prevRanks[playerId] = player.rank;
    }

    // If we have existing rows and should animate, do a smooth transition
    if (animate && this.currentPlayers.length > 0 && previousSnapshot) {
      this.animateTransition(players, prevRanks);
    } else {
      this.renderFull(players, prevRanks);
    }

    this.currentPlayers = players;
    this.previousSnapshot = snapshot;
  },

  /**
   * Full render (no animation)
   */
  renderFull(players, prevRanks) {
    // Build new DOM in a fragment first
    const fragment = document.createDocumentFragment();

    for (const player of players) {
      const playerId = Stats.getPlayerId(player);
      const row = this.createRow(player, prevRanks[playerId]);
      fragment.appendChild(row);
    }

    // Replace content atomically
    this.container.innerHTML = "";
    this.container.appendChild(fragment);
  },

  /**
   * Animate transition between snapshots
   */
  animateTransition(newPlayers, prevRanks) {
    // Create a map of new positions
    const newPositions = {};
    for (let i = 0; i < newPlayers.length; i++) {
      const playerId = Stats.getPlayerId(newPlayers[i]);
      newPositions[playerId] = i;
    }

    // Create a map of old positions
    const oldPositions = {};
    for (let i = 0; i < this.currentPlayers.length; i++) {
      const playerId = Stats.getPlayerId(this.currentPlayers[i]);
      oldPositions[playerId] = i;
    }

    // Build new DOM
    const fragment = document.createDocumentFragment();
    const rowsToAnimate = [];

    for (const player of newPlayers) {
      const playerId = Stats.getPlayerId(player);
      const row = this.createRow(player, prevRanks[playerId]);
      const newPosition = newPositions[playerId];
      const oldPosition = oldPositions[playerId];

      // Track rows that need animation
      if (oldPosition !== undefined && oldPosition !== newPosition) {
        const rowHeight = 40; // var(--row-height)
        const deltaY = (oldPosition - newPosition) * rowHeight;
        rowsToAnimate.push({ row, deltaY, movedUp: newPosition < oldPosition });
      } else if (oldPosition === undefined) {
        // New player entering the leaderboard
        rowsToAnimate.push({ row, deltaY: 0, isNew: true });
      }

      fragment.appendChild(row);
    }

    // Replace DOM
    this.container.innerHTML = "";
    this.container.appendChild(fragment);

    // Get speed-based durations
    const { slide, flash } = this.getAnimationDurations();

    // Animate after DOM is in place (use requestAnimationFrame for proper timing)
    requestAnimationFrame(() => {
      for (const { row, deltaY, movedUp, isNew } of rowsToAnimate) {
        if (isNew) {
          row.classList.add("animate-up");
          setTimeout(() => row.classList.remove("animate-up"), flash);
        } else {
          // Set initial position (where it came from)
          row.style.transform = `translateY(${deltaY}px)`;
          row.style.transition = "none";

          // Force reflow
          row.offsetHeight;

          // Animate to final position
          row.style.transition = `transform ${slide}s cubic-bezier(0.4, 0, 0.2, 1)`;
          row.style.transform = "translateY(0)";

          // Add flash animation
          row.classList.add(movedUp ? "animate-up" : "animate-down");
          setTimeout(() => {
            row.classList.remove("animate-up", "animate-down");
          }, flash);
        }
      }
    });
  },

  /**
   * Create a leaderboard row element
   */
  createRow(player, prevRank) {
    const row = document.createElement("div");
    row.className = "leaderboard-row";
    const playerId = Stats.getPlayerId(player);
    row.dataset.playerId = playerId;

    // Rank styling
    let rankClass = "";
    if (player.rank === 1) rankClass = "top-1";
    else if (player.rank <= 3) rankClass = "top-3";
    else if (player.rank <= 10) rankClass = "top-10";

    // Change indicator
    const change = this.getChangeDisplay(player.rank, prevRank);

    // Flag image
    const flagUrl = Stats.getFlagUrl(player.country);
    const flagHtml = flagUrl
      ? `<img class="player-flag" src="${flagUrl}" alt="${
          player.country
        }" title="${
          player.country?.toUpperCase() || ""
        }" onerror="this.style.display='none'">`
      : "";

    // Favorite star
    const favoriteHtml = Favorites.isFavorite(playerId)
      ? '<span class="favorite-star small active display-only">★</span>'
      : "";

    row.innerHTML = `
      <span class="rank ${rankClass}">${player.rank}</span>
      <span class="change ${change.class}">${change.text}</span>
      <span class="team">${player.team_tag || ""}</span>
      <span class="name">${favoriteHtml}${this.escapeHtml(player.name)}</span>
      <span class="flag">${flagHtml}</span>
      <span class="chevron">›</span>
    `;

    // Click handler
    row.addEventListener("click", () => {
      if (window.PlayerModal) {
        window.PlayerModal.show(playerId);
      }
    });

    return row;
  },

  /**
   * Update an existing row's content
   */
  updateRowContent(row, player, prevRank) {
    const rankEl = row.querySelector(".rank");
    const changeEl = row.querySelector(".change");
    const nameEl = row.querySelector(".name");
    const teamEl = row.querySelector(".team");

    // Update rank
    rankEl.textContent = player.rank;
    rankEl.className = "rank";
    if (player.rank === 1) rankEl.classList.add("top-1");
    else if (player.rank <= 3) rankEl.classList.add("top-3");
    else if (player.rank <= 10) rankEl.classList.add("top-10");

    // Update change
    const change = this.getChangeDisplay(player.rank, prevRank);
    changeEl.textContent = change.text;
    changeEl.className = `change ${change.class}`;

    // Update name and team
    const flagUrl = Stats.getFlagUrl(player.country);
    const flagHtml = flagUrl
      ? `<img class="player-flag" src="${flagUrl}" alt="${
          player.country
        }" title="${
          player.country?.toUpperCase() || ""
        }" onerror="this.style.display='none'">`
      : "";
    nameEl.textContent = player.name;
    teamEl.textContent = player.team_tag || "";

    // Update flag
    const flagEl = row.querySelector(".flag");
    if (flagEl) flagEl.innerHTML = flagHtml;
  },

  /**
   * Get change display text and class
   */
  getChangeDisplay(currentRank, prevRank) {
    if (prevRank === undefined || prevRank === null) {
      return { text: "NEW", class: "up" };
    }

    const diff = prevRank - currentRank;

    if (diff > 0) {
      return { text: `↑${diff}`, class: "up" };
    } else if (diff < 0) {
      return { text: `↓${Math.abs(diff)}`, class: "down" };
    } else {
      return { text: "-", class: "same" };
    }
  },

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  },
};

// Export for use in other modules
window.Leaderboard = Leaderboard;
