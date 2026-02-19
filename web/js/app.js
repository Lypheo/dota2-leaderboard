/**
 * Main application entry point
 * Coordinates all modules and handles data loading
 */

const App = {
  data: null,
  playerHistory: null,
  currentRegion: "europe",

  // Region configuration
  regions: {
    americas: { name: "Americas", file: "americas" },
    europe: { name: "Europe", file: "europe" },
    sea: { name: "SE Asia", file: "sea" },
    china: { name: "China", file: "china" },
  },

  /**
   * Initialize the application
   */
  async init() {
    try {
      // Determine initial region from URL hash or localStorage
      this.currentRegion = this.getInitialRegion();

      // Initialize favorites
      Favorites.init();

      // Setup region selector
      this.setupRegionSelector();

      // Load data for current region
      await this.loadData();

      // Initialize modules
      this.initModules();

      // Load saved scope preferences
      const savedWinnersScope = localStorage.getItem("winnersScope") || "20";
      const savedLosersScope = localStorage.getItem("losersScope") || "20";
      const savedTimeScope = localStorage.getItem("timeScope") || "7";

      // Set dropdown values from saved preferences
      document.getElementById("winners-scope").value = savedWinnersScope;
      document.getElementById("losers-scope").value = savedLosersScope;
      document.getElementById("time-scope").value = savedTimeScope;
      document.getElementById("time-scope-losers").value = savedTimeScope;
      document.getElementById("favorites-time-scope").value = savedTimeScope;

      // Render initial state with saved scopes
      this.renderStats(
        parseInt(savedWinnersScope),
        parseInt(savedLosersScope),
        parseInt(savedTimeScope),
      );
      this.renderInitialLeaderboard();
      this.renderFavorites();
      this.setupScopeFilters();
      this.setupExpandToggle();
      this.setupTeamChangesToggle();
      this.setupAboutModal();

      // Re-render favorites when they change
      Favorites.onChange(() => {
        this.renderFavorites();
        this.renderStats(
          parseInt(document.getElementById("winners-scope").value),
          parseInt(document.getElementById("losers-scope").value),
          parseInt(document.getElementById("time-scope").value),
        );
        // Re-render leaderboard to update stars
        this.renderInitialLeaderboard();
      });

      // Hide loading, show content
      document.getElementById("loading").classList.add("hidden");
      document.getElementById("main-content").classList.remove("hidden");

      // Listen for hash changes
      window.addEventListener("hashchange", () => this.handleHashChange());
    } catch (error) {
      console.error("Failed to initialize app:", error);
      document.getElementById("loading").classList.add("hidden");
      document.getElementById("error").classList.remove("hidden");
    }
  },

  /**
   * Get initial region from URL hash or localStorage
   */
  getInitialRegion() {
    // Check URL hash first
    const hash = window.location.hash.slice(1).toLowerCase();
    if (hash && this.regions[hash]) {
      return hash;
    }

    // Fall back to localStorage
    const saved = localStorage.getItem("selectedRegion");
    if (saved && this.regions[saved]) {
      return saved;
    }

    // Default to europe
    return "europe";
  },

  /**
   * Handle URL hash changes
   */
  handleHashChange() {
    const hash = window.location.hash.slice(1).toLowerCase();
    if (hash && this.regions[hash] && hash !== this.currentRegion) {
      this.switchRegion(hash);
    }
  },

  /**
   * Setup region selector pills
   */
  setupRegionSelector() {
    const selector = document.getElementById("region-selector");
    const pills = selector.querySelectorAll(".region-pill");

    // Set initial active state
    pills.forEach((pill) => {
      if (pill.dataset.region === this.currentRegion) {
        pill.classList.add("active");
      }

      pill.addEventListener("click", () => {
        const region = pill.dataset.region;
        if (region !== this.currentRegion) {
          this.switchRegion(region);
        }
      });
    });

    // Update URL hash to reflect current region
    window.location.hash = this.currentRegion;
  },

  /**
   * Switch to a different region
   */
  async switchRegion(region) {
    if (!this.regions[region]) return;

    this.currentRegion = region;
    localStorage.setItem("selectedRegion", region);
    window.location.hash = region;

    // Update pill states
    document.querySelectorAll(".region-pill").forEach((pill) => {
      pill.classList.toggle("active", pill.dataset.region === region);
    });

    // Show loading state
    document.getElementById("main-content").classList.add("hidden");
    document.getElementById("loading").classList.remove("hidden");

    try {
      // Reload data for new region
      await this.loadData();

      // Rebuild player history
      this.playerHistory = Stats.buildPlayerHistory(this.data.snapshots);

      // Re-initialize timeline with new data
      Timeline.init(this.data.snapshots, (snapshot, previousSnapshot) => {
        Leaderboard.render(snapshot, previousSnapshot, true);
      });

      // Re-initialize player modal with new history
      PlayerModal.init(this.playerHistory, this.data.snapshots);

      // Re-render everything
      const winnersScope = parseInt(
        document.getElementById("winners-scope").value,
      );
      const losersScope = parseInt(
        document.getElementById("losers-scope").value,
      );
      const timeScope = parseInt(document.getElementById("time-scope").value);

      this.renderStats(winnersScope, losersScope, timeScope);
      this.renderInitialLeaderboard();
      this.renderFavorites();

      // Hide loading, show content
      document.getElementById("loading").classList.add("hidden");
      document.getElementById("main-content").classList.remove("hidden");
    } catch (error) {
      console.error("Failed to switch region:", error);
      document.getElementById("loading").classList.add("hidden");
      document.getElementById("error").classList.remove("hidden");
    }
  },

  /**
   * Load history data from JSON file for current region
   */
  async loadData() {
    const response = await fetch(`data/history-${this.currentRegion}.json`);
    if (!response.ok) {
      throw new Error(`Failed to load data: ${response.status}`);
    }

    this.data = await response.json();

    if (!this.data.snapshots || this.data.snapshots.length === 0) {
      throw new Error("No snapshots in data");
    }

    // Filter out empty snapshots (extraction script now crops to 500)
    this.data.snapshots = this.data.snapshots.filter(
      (snapshot) => snapshot.players.length > 0,
    );

    if (this.data.snapshots.length === 0) {
      throw new Error("No valid snapshots after filtering");
    }

    console.log(`Loaded ${this.data.snapshots.length} snapshots`);
    console.log(
      `Date range: ${this.data.snapshots[0].timestamp} to ${
        this.data.snapshots[this.data.snapshots.length - 1].timestamp
      }`,
    );

    // Build player history for stats
    this.playerHistory = Stats.buildPlayerHistory(this.data.snapshots);

    // Migrate favorites that reference old name|country IDs (pre-identity-resolution)
    this.migrateFavorites();
  },

  /**
   * Migrate favorites that reference old name|country IDs.
   * After identity resolution, a player who changed country keeps their
   * first-seen name|country as canonical ID. If a user favorited using
   * the newer name|country, that ID no longer exists — migrate it.
   */
  migrateFavorites() {
    const favoriteIds = Favorites.getAll();
    if (favoriteIds.length === 0) return;

    // Build alias map: for each player, record all name|country combos
    // that map to their canonical ID (including the current combo if different)
    const aliasMap = {}; // name|country -> canonical ID

    for (const snapshot of this.data.snapshots) {
      for (const player of snapshot.players) {
        const nameCountry = `${player.name}|${player.country || ""}`;
        if (player.id && player.id !== nameCountry) {
          aliasMap[nameCountry] = player.id;
        }
      }
    }

    // Migrate orphaned favorites
    for (const favId of favoriteIds) {
      if (!this.playerHistory[favId] && aliasMap[favId]) {
        console.log(`Migrating favorite: ${favId} → ${aliasMap[favId]}`);
        Favorites.remove(favId);
        Favorites.add(aliasMap[favId]);
      }
    }
  },

  /**
   * Initialize all modules
   */
  initModules() {
    // Initialize leaderboard
    Leaderboard.init();

    // Set up filter change callback to re-render winners/losers
    Leaderboard.onFilterChange = () => {
      const winnersScope = parseInt(
        document.getElementById("winners-scope").value,
      );
      const losersScope = parseInt(
        document.getElementById("losers-scope").value,
      );
      const timeScope = parseInt(document.getElementById("time-scope").value);
      this.renderStats(winnersScope, losersScope, timeScope);
    };

    // Initialize timeline with callback
    Timeline.init(this.data.snapshots, (snapshot, previousSnapshot) => {
      Leaderboard.render(snapshot, previousSnapshot, true);
    });

    // Initialize player modal
    PlayerModal.init(this.playerHistory, this.data.snapshots);
  },

  /**
   * Render statistics cards
   */
  renderStats(winnersScope = 500, losersScope = 500, timeDays = 0) {
    // Check if we should filter to pros only
    const prosOnly = Leaderboard.teamsOnly;

    let winners = Stats.getWinners(
      this.playerHistory,
      prosOnly ? 50 : 5, // Fetch more if filtering
      winnersScope,
      timeDays,
      this.data.snapshots,
    );
    let losers = Stats.getLosers(
      this.playerHistory,
      prosOnly ? 50 : 5, // Fetch more if filtering
      losersScope,
      timeDays,
      this.data.snapshots,
    );

    // Filter to pros only if enabled
    if (prosOnly) {
      winners = winners
        .filter((p) => p.team_tag && p.team_tag.trim() !== "")
        .slice(0, 5);
      losers = losers
        .filter((p) => p.team_tag && p.team_tag.trim() !== "")
        .slice(0, 5);
    }

    // Render winners
    const winnersList = document.getElementById("winners-list");
    winnersList.innerHTML = winners
      .map(
        (w, i) => `
      <li data-player-id="${this.escapeAttr(w.id)}">
        <span>
          <span class="player-rank-num">${i + 1}.</span>
          ${Favorites.isFavorite(w.id) ? '<span class="favorite-star small active display-only">★</span>' : ""}
          ${
            w.team_tag
              ? `<span class="player-team">${this.escapeHtml(
                  w.team_tag,
                )}.</span>`
              : ""
          }<span class="player-name">${this.escapeHtml(w.name)}</span>
          ${
            w.country
              ? `<img class="player-flag" src="${Stats.getFlagUrl(
                  w.country,
                )}" alt="${
                  w.country
                }" title="${w.country.toUpperCase()}" onerror="this.style.display='none'">`
              : ""
          }
        </span>
        <span class="rank-change positive">+${w.change} (${w.firstRank}→${
          w.lastRank
        })</span>
      </li>
    `,
      )
      .join("");

    // Add click handlers for winners
    winnersList.querySelectorAll("li").forEach((li) => {
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        PlayerModal.show(li.dataset.playerId);
      });
    });

    // Render losers
    const losersList = document.getElementById("losers-list");
    losersList.innerHTML = losers
      .map(
        (l, i) => `
      <li data-player-id="${this.escapeAttr(l.id)}">
        <span>
          <span class="player-rank-num">${i + 1}.</span>
          ${Favorites.isFavorite(l.id) ? '<span class="favorite-star small active display-only">★</span>' : ""}
          ${
            l.team_tag
              ? `<span class="player-team">${this.escapeHtml(
                  l.team_tag,
                )}.</span>`
              : ""
          }<span class="player-name">${this.escapeHtml(l.name)}</span>
          ${
            l.country
              ? `<img class="player-flag" src="${Stats.getFlagUrl(
                  l.country,
                )}" alt="${
                  l.country
                }" title="${l.country.toUpperCase()}" onerror="this.style.display='none'">`
              : ""
          }
        </span>
        <span class="rank-change negative">-${l.change} (${l.firstRank}→${
          l.lastRank
        })</span>
      </li>
    `,
      )
      .join("");

    // Add click handlers for losers
    losersList.querySelectorAll("li").forEach((li) => {
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        PlayerModal.show(li.dataset.playerId);
      });
    });

    // Render team changes
    this.renderTeamChanges(timeDays);
  },

  /**
   * Update the favorites-team-row layout class
   */
  updateFavoritesTeamRowLayout() {
    const row = document.querySelector(".favorites-team-row");
    const favoritesSection = document.getElementById("favorites-section");
    const teamChangesSection = document.getElementById("team-changes-section");

    const favoritesVisible = !favoritesSection.classList.contains("hidden");
    const teamChangesVisible =
      !teamChangesSection.classList.contains("hidden") &&
      !teamChangesSection.classList.contains("collapsed");

    if (favoritesVisible && teamChangesVisible) {
      row.classList.add("has-both");
    } else {
      row.classList.remove("has-both");
    }
  },

  /**
   * Render favorites section
   */
  renderFavorites() {
    const section = document.getElementById("favorites-section");
    const list = document.getElementById("favorites-list");
    const timeDays = parseInt(
      document.getElementById("favorites-time-scope").value,
    );

    const favoriteIds = Favorites.getAll();

    // Hide section if no favorites
    if (favoriteIds.length === 0) {
      section.classList.add("hidden");
      this.updateFavoritesTeamRowLayout();
      return;
    }

    section.classList.remove("hidden");
    this.updateFavoritesTeamRowLayout();

    // Get player changes for favorites
    const favoriteChanges = [];

    // Build history for the time period
    const history = Stats.buildPlayerHistory(this.data.snapshots, timeDays);

    for (const playerId of favoriteIds) {
      const playerData = history[playerId];

      if (playerData && playerData.ranks.length >= 1) {
        const firstRank = playerData.ranks[0].rank;
        const lastRank = playerData.ranks[playerData.ranks.length - 1].rank;
        const netChange = firstRank - lastRank; // Positive = improved

        // Calculate total up and down movements
        let totalUp = 0;
        let totalDown = 0;
        for (let i = 1; i < playerData.ranks.length; i++) {
          const prevRank = playerData.ranks[i - 1].rank;
          const currRank = playerData.ranks[i].rank;
          const diff = prevRank - currRank; // Positive = went up (improved)
          if (diff > 0) {
            totalUp += diff;
          } else if (diff < 0) {
            totalDown += Math.abs(diff);
          }
        }

        favoriteChanges.push({
          id: playerId,
          name: playerData.name,
          team_tag: playerData.team_tag,
          country: playerData.country,
          firstRank,
          lastRank,
          netChange,
          totalUp,
          totalDown,
          totalMovement: totalUp + totalDown,
        });
      } else {
        // Player might not have recent history, get latest data
        const latestHistory = this.playerHistory[playerId];
        if (latestHistory) {
          favoriteChanges.push({
            id: playerId,
            name: latestHistory.name,
            team_tag: latestHistory.team_tag,
            country: latestHistory.country,
            firstRank:
              latestHistory.ranks[latestHistory.ranks.length - 1]?.rank || 0,
            lastRank:
              latestHistory.ranks[latestHistory.ranks.length - 1]?.rank || 0,
            netChange: 0,
            totalUp: 0,
            totalDown: 0,
            totalMovement: 0,
          });
        }
      }
    }

    // Sort by net change (positive first, negative last)
    favoriteChanges.sort((a, b) => b.netChange - a.netChange);

    list.innerHTML = favoriteChanges
      .map((f) => {
        // Build comprehensive change display: Down X | Up Y | Net
        let changeHtml =
          '<span class="favorite-changes"><span class="change same">-</span></span>';

        if (f.totalDown > 0 || f.totalUp > 0) {
          const downPart =
            f.totalDown > 0
              ? `<span class="change down small">↓${f.totalDown}</span>`
              : "";
          const upPart =
            f.totalUp > 0
              ? `<span class="change up small">↑${f.totalUp}</span>`
              : "";

          let netPart = "";
          if (f.netChange > 0) {
            netPart = `<span class="change up net">↑${f.netChange}</span>`;
          } else if (f.netChange < 0) {
            netPart = `<span class="change down net">↓${Math.abs(f.netChange)}</span>`;
          } else if (f.totalDown > 0 || f.totalUp > 0) {
            netPart = '<span class="change same net">=</span>';
          }

          const rankTransition = `<span class="rank-transition">(${f.firstRank}→${f.lastRank})</span>`;

          changeHtml = `<span class="favorite-changes">${downPart}${upPart}${netPart}${rankTransition}</span>`;
        }

        return `
          <li data-player-id="${this.escapeAttr(f.id)}">
            <span>
              <span class="player-rank-num">#${f.lastRank}</span>
              <span class="favorite-star small active display-only">★</span>
              ${f.team_tag ? `<span class="player-team">${this.escapeHtml(f.team_tag)}.</span>` : ""}
              <span class="player-name">${this.escapeHtml(f.name)}</span>
              ${f.country ? `<img class="player-flag" src="${Stats.getFlagUrl(f.country)}" alt="${f.country}" title="${f.country.toUpperCase()}" onerror="this.style.display='none'">` : ""}
            </span>
            ${changeHtml}
          </li>
        `;
      })
      .join("");

    // Add click handlers
    list.querySelectorAll("li").forEach((li) => {
      li.addEventListener("click", (e) => {
        e.stopPropagation();
        PlayerModal.show(li.dataset.playerId);
      });
    });
  },

  /**
   * Render team changes section
   */
  renderTeamChanges(timeDays) {
    const changes = Stats.getTeamChanges(this.data.snapshots, timeDays);
    const section = document.getElementById("team-changes-section");
    const list = document.getElementById("team-changes-list");
    const countSpan = document.getElementById("team-changes-count");
    const toggleBtn = document.getElementById("team-changes-toggle");

    if (changes.length === 0) {
      section.classList.add("hidden");
      this.updateFavoritesTeamRowLayout();
      return;
    }

    section.classList.remove("hidden");
    this.updateFavoritesTeamRowLayout();

    // Show count in header
    countSpan.textContent = `(${changes.length})`;

    // Show/hide toggle button based on count (show if more than 4)
    const COLLAPSE_THRESHOLD = 4;
    if (changes.length > COLLAPSE_THRESHOLD) {
      toggleBtn.classList.remove("hidden");
    } else {
      toggleBtn.classList.add("hidden");
      section.classList.remove("collapsed");
    }

    list.innerHTML = changes
      .map((c) => {
        const flagUrl = Stats.getFlagUrl(c.country);
        const flagHtml = flagUrl
          ? `<img class="player-flag" src="${flagUrl}" alt="${
              c.country
            }" title="${
              c.country?.toUpperCase() || ""
            }" onerror="this.style.display='none'">`
          : "";
        const oldTeam = c.fromTeam
          ? `<span class="old-team">${this.escapeHtml(c.fromTeam)}</span>`
          : `<span class="no-team">No Team</span>`;
        const newTeam = c.toTeam
          ? `<span class="new-team">${this.escapeHtml(c.toTeam)}</span>`
          : `<span class="no-team">No Team</span>`;

        return `
          <div class="team-change-item" data-player-id="${this.escapeAttr(
            c.id,
          )}">
            ${flagHtml}
            <span class="player-name">${this.escapeHtml(c.name)}</span>
            ${oldTeam}
            <span class="team-arrow">→</span>
            ${newTeam}
          </div>
        `;
      })
      .join("");

    // Add click handlers
    list.querySelectorAll(".team-change-item").forEach((item) => {
      item.addEventListener("click", () => {
        PlayerModal.show(item.dataset.playerId);
      });
    });
  },

  /**
   * Setup team changes toggle
   */
  setupTeamChangesToggle() {
    const section = document.getElementById("team-changes-section");
    const toggleBtn = document.getElementById("team-changes-toggle");

    toggleBtn.addEventListener("click", () => {
      section.classList.toggle("collapsed");
      // Update row layout since collapsed team changes is hidden on desktop
      this.updateFavoritesTeamRowLayout();
    });
  },

  /**
   * Setup About modal
   */
  setupAboutModal() {
    const modal = document.getElementById("about-modal");
    const openBtn = document.getElementById("about-btn");
    const closeBtn = document.getElementById("about-modal-close");

    const showModal = () => {
      modal.classList.remove("hidden");
      document.body.style.overflow = "hidden";
      // Push history state so back button closes modal
      history.pushState({ aboutModal: true }, "");
    };

    const hideModal = (updateHistory = false) => {
      if (modal.classList.contains("hidden")) return;

      modal.classList.add("hidden");
      document.body.style.overflow = "";

      // Go back in history if closed by user action (not by popstate)
      if (updateHistory && history.state && history.state.aboutModal) {
        history.back();
      }
    };

    openBtn.addEventListener("click", showModal);
    closeBtn.addEventListener("click", () => hideModal(true));

    // Click outside to close
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        hideModal(true);
      }
    });

    // ESC key to close
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.classList.contains("hidden")) {
        hideModal(true);
      }
    });

    // Handle browser back button
    window.addEventListener("popstate", (e) => {
      if (
        !modal.classList.contains("hidden") &&
        (!e.state || !e.state.aboutModal)
      ) {
        hideModal(false);
      }
    });
  },

  /**
   * Setup scope filter dropdowns
   */
  setupScopeFilters() {
    const winnersSelect = document.getElementById("winners-scope");
    const losersSelect = document.getElementById("losers-scope");
    const timeSelect = document.getElementById("time-scope");
    const timeSelectLosers = document.getElementById("time-scope-losers");

    const getScopes = () => ({
      winners: parseInt(winnersSelect.value),
      losers: parseInt(losersSelect.value),
      time: parseInt(timeSelect.value),
    });

    winnersSelect.addEventListener("change", () => {
      losersSelect.value = winnersSelect.value; // Sync losers dropdown
      const scopes = getScopes();
      localStorage.setItem("winnersScope", winnersSelect.value);
      localStorage.setItem("losersScope", winnersSelect.value);
      this.renderStats(scopes.winners, scopes.losers, scopes.time);
    });

    losersSelect.addEventListener("change", () => {
      winnersSelect.value = losersSelect.value; // Sync winners dropdown
      const scopes = getScopes();
      localStorage.setItem("winnersScope", losersSelect.value);
      localStorage.setItem("losersScope", losersSelect.value);
      this.renderStats(scopes.winners, scopes.losers, scopes.time);
    });

    const favoritesTimeSelect = document.getElementById("favorites-time-scope");

    const syncAllTimeSelects = (value) => {
      timeSelect.value = value;
      timeSelectLosers.value = value;
      favoritesTimeSelect.value = value;
      localStorage.setItem("timeScope", value);
    };

    timeSelect.addEventListener("change", () => {
      syncAllTimeSelects(timeSelect.value);
      const scopes = getScopes();
      this.renderStats(scopes.winners, scopes.losers, scopes.time);
      this.renderFavorites();
    });

    timeSelectLosers.addEventListener("change", () => {
      syncAllTimeSelects(timeSelectLosers.value);
      const scopes = getScopes();
      this.renderStats(scopes.winners, scopes.losers, scopes.time);
      this.renderFavorites();
    });

    favoritesTimeSelect.addEventListener("change", () => {
      syncAllTimeSelects(favoritesTimeSelect.value);
      const scopes = getScopes();
      this.renderStats(scopes.winners, scopes.losers, scopes.time);
      this.renderFavorites();
    });
  },

  /**
   * Setup expand/compact toggle for leaderboard
   */
  setupExpandToggle() {
    const toggle = document.getElementById("expand-toggle");
    const app = document.querySelector(".app");

    // Always start in expanded mode (showing header and stats)
    toggle.addEventListener("click", () => {
      const isNowCompact = app.classList.toggle("compact");
      toggle.textContent = isNowCompact ? "↙" : "↗";
      toggle.title = isNowCompact
        ? "Show header and stats"
        : "Toggle compact mode";
    });
  },

  /**
   * Render initial leaderboard (most recent snapshot)
   */
  renderInitialLeaderboard() {
    const currentSnapshot = Timeline.getCurrentSnapshot();
    const previousSnapshot = Timeline.getPreviousSnapshot();

    Leaderboard.render(currentSnapshot, previousSnapshot, false);
  },

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * Escape attribute value
   */
  escapeAttr(text) {
    return text.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  },
};

// Start the app when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
