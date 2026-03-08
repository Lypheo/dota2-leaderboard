/**
 * Main application entry point
 * Coordinates all modules and handles data loading
 */

const App = {
  data: null,
  playerHistory: null,
  currentRegion: "europe",

  // Global filter state
  prosOnly: false,
  selectedCountry: "",

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

      // Load saved filter preferences BEFORE initModules so country filter populates correctly
      const savedRankScope = localStorage.getItem("rankScope") || "20";
      const savedTimeScope = localStorage.getItem("timeScope") || "7";
      this.selectedCountry = localStorage.getItem("selectedCountry") || "";
      this.prosOnly = localStorage.getItem("prosOnly") === "true";

      // Initialize modules (populateCountryFilter needs selectedCountry set)
      this.initModules();

      // Set dropdown values from saved preferences
      document.getElementById("rank-scope").value = savedRankScope;
      document.getElementById("time-scope").value = savedTimeScope;

      // Set pros-only toggle state
      const prosToggle = document.getElementById("pros-only-toggle");
      if (prosToggle && this.prosOnly) {
        prosToggle.classList.add("active");
      }

      // Render initial state with saved scopes
      this.renderStats(parseInt(savedRankScope), parseInt(savedTimeScope));
      this.renderInitialLeaderboard();
      this.renderFavorites();
      this.setupGlobalFilters();
      this.setupExpandToggle();
      this.setupTeamChangesToggle();
      this.setupAboutModal();

      // Re-render favorites when they change
      Favorites.onChange(() => {
        this.renderFavorites();
        this.renderStats(
          parseInt(document.getElementById("rank-scope").value),
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

      // Re-populate country filter with new region's countries
      this.populateCountryFilter();

      // Re-render everything
      const rankScope = parseInt(document.getElementById("rank-scope").value);
      const timeScope = parseInt(document.getElementById("time-scope").value);

      this.renderStats(rankScope, timeScope);
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

    // Filter out empty snapshots (extraction script now crops to 5000)
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
    await this.migrateFavorites();
  },

  /**
   * Migrate favorites that reference old name|country IDs.
   * After identity resolution, a player who changed country keeps their
   * first-seen name|country as canonical ID. If a user favorited using
   * the newer name|country, that ID no longer exists — migrate it.
   *
   * Uses two sources for alias resolution:
   * 1. Snapshot data (player.id != name|country)
   * 2. Persistent registry aliases file (covers IDs that aged out of snapshots)
   */
  async migrateFavorites() {
    const favoriteIds = Favorites.getAll();
    if (favoriteIds.length === 0) return;

    // Build alias map from snapshot data
    const aliasMap = {}; // name|country -> canonical ID

    for (const snapshot of this.data.snapshots) {
      for (const player of snapshot.players) {
        const nameCountry = `${player.name}|${player.country || ""}`;
        if (player.id && player.id !== nameCountry) {
          aliasMap[nameCountry] = player.id;
        }
      }
    }

    // Also load persistent registry aliases (covers IDs outside snapshot window)
    try {
      const registryResponse = await fetch(
        `data/registry-${this.currentRegion}.json`,
      );
      if (registryResponse.ok) {
        const registry = await registryResponse.json();
        if (registry.aliases) {
          for (const [combo, stableId] of Object.entries(registry.aliases)) {
            if (combo !== stableId && !aliasMap[combo]) {
              aliasMap[combo] = stableId;
            }
          }
        }
      }
    } catch (e) {
      // Registry file may not exist yet, that's fine
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
   * Get human-readable country name from code
   */
  getCountryName(code) {
    try {
      const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
      return regionNames.of(code.toUpperCase()) || code.toUpperCase();
    } catch {
      return code.toUpperCase();
    }
  },

  /**
   * Populate country filter picker with countries from current data
   */
  populateCountryFilter() {
    const optionsContainer = document.getElementById("country-picker-options");
    const input = document.getElementById("country-picker-input");
    const flag = document.getElementById("country-picker-flag");
    const clearBtn = document.getElementById("country-picker-clear");
    if (!optionsContainer || !input) return;

    // Collect unique countries from all snapshots
    const countries = new Set();
    for (const snapshot of this.data.snapshots) {
      for (const player of snapshot.players) {
        if (player.country) {
          countries.add(player.country.toLowerCase());
        }
      }
    }

    // Sort by country name
    const sorted = [...countries].sort((a, b) => {
      return this.getCountryName(a).localeCompare(this.getCountryName(b));
    });

    // Store for search filtering
    this.countryList = sorted;

    // Build options
    this.renderCountryOptions(sorted);

    // Set initial input value from saved selection
    if (this.selectedCountry) {
      input.value = this.getCountryName(this.selectedCountry);
      if (flag) {
        flag.src = Stats.getFlagUrl(this.selectedCountry);
        flag.classList.remove("hidden");
        flag.style.display = "";
      }
      if (clearBtn) clearBtn.classList.remove("hidden");
    } else {
      input.value = "";
      if (flag) flag.classList.add("hidden");
      if (clearBtn) clearBtn.classList.add("hidden");
    }
  },

  /**
   * Render country picker options (used by search filtering)
   */
  renderCountryOptions(codes) {
    const optionsContainer = document.getElementById("country-picker-options");
    if (!optionsContainer) return;
    const selected = this.selectedCountry;

    let html = "";

    for (const code of codes) {
      const flagUrl = Stats.getFlagUrl(code);
      const name = this.escapeHtml(this.getCountryName(code));
      const isSelected = code === selected;
      html += `<div class="country-option${isSelected ? " selected" : ""}" data-value="${code}">
        <img class="player-flag" src="${flagUrl}" onerror="this.style.display='none'">
        <span>${name}</span>
        <span class="country-code">${code.toUpperCase()}</span>
      </div>`;
    }

    optionsContainer.innerHTML = html;
  },

  /**
   * Initialize all modules
   */
  initModules() {
    // Initialize leaderboard
    Leaderboard.init();

    // Populate country filter dropdown
    this.populateCountryFilter();

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
  renderStats(rankScope = 5000, timeDays = 0) {
    // Read global filter state
    const prosOnly = this.prosOnly;
    const countryFilter = this.selectedCountry;

    const needsPostFilter = prosOnly || countryFilter;

    let winners = Stats.getWinners(
      this.playerHistory,
      needsPostFilter ? 5000 : 5,
      rankScope,
      timeDays,
      this.data.snapshots,
    );
    let losers = Stats.getLosers(
      this.playerHistory,
      needsPostFilter ? 5000 : 5,
      rankScope,
      timeDays,
      this.data.snapshots,
    );

    // Filter to pros only if enabled
    if (prosOnly) {
      winners = winners.filter((p) => p.team_tag && p.team_tag.trim() !== "");
      losers = losers.filter((p) => p.team_tag && p.team_tag.trim() !== "");
    }

    // Filter by country if selected
    if (countryFilter) {
      winners = winners.filter(
        (p) =>
          p.country && p.country.toLowerCase() === countryFilter.toLowerCase(),
      );
      losers = losers.filter(
        (p) =>
          p.country && p.country.toLowerCase() === countryFilter.toLowerCase(),
      );
    }

    // Limit to 5 results after all filters
    winners = winners.slice(0, 5);
    losers = losers.slice(0, 5);

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
    this.renderTeamChanges(timeDays, rankScope);
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
    const timeDays = parseInt(document.getElementById("time-scope").value);

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
  renderTeamChanges(timeDays, rankScope = 5000) {
    let changes = Stats.getTeamChanges(this.data.snapshots, timeDays);
    const section = document.getElementById("team-changes-section");
    const list = document.getElementById("team-changes-list");
    const countSpan = document.getElementById("team-changes-count");
    const toggleBtn = document.getElementById("team-changes-toggle");

    // Apply global filters to team changes
    if (rankScope < 5000) {
      changes = changes.filter((c) => c.rank != null && c.rank <= rankScope);
    }
    if (this.prosOnly) {
      changes = changes.filter((c) => c.fromTeam || c.toTeam);
    }
    if (this.selectedCountry) {
      changes = changes.filter(
        (c) =>
          c.country &&
          c.country.toLowerCase() === this.selectedCountry.toLowerCase(),
      );
    }

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
   * Setup global filter bar controls
   */
  setupGlobalFilters() {
    const rankScopeSelect = document.getElementById("rank-scope");
    const timeSelect = document.getElementById("time-scope");
    const prosToggle = document.getElementById("pros-only-toggle");

    const rerender = () => {
      const rankScope = parseInt(rankScopeSelect.value);
      const timeScope = parseInt(timeSelect.value);
      this.renderStats(rankScope, timeScope);
      this.renderFavorites();
      this.renderInitialLeaderboard();
    };

    rankScopeSelect.addEventListener("change", () => {
      localStorage.setItem("rankScope", rankScopeSelect.value);
      rerender();
    });

    timeSelect.addEventListener("change", () => {
      localStorage.setItem("timeScope", timeSelect.value);
      rerender();
    });

    prosToggle.addEventListener("click", () => {
      this.prosOnly = !this.prosOnly;
      localStorage.setItem("prosOnly", this.prosOnly);
      prosToggle.classList.toggle("active", this.prosOnly);
      rerender();
    });

    // Country picker (combobox)
    const pickerInput = document.getElementById("country-picker-input");
    const pickerDropdown = document.getElementById("country-picker-dropdown");
    const pickerOptions = document.getElementById("country-picker-options");
    const pickerFlag = document.getElementById("country-picker-flag");
    const pickerClear = document.getElementById("country-picker-clear");

    const openPicker = () => {
      if (!pickerDropdown.classList.contains("hidden")) return;
      const query = pickerInput.value.toLowerCase();
      const filtered = (this.countryList || []).filter((code) => {
        const name = this.getCountryName(code).toLowerCase();
        return name.includes(query) || code.includes(query);
      });
      this.renderCountryOptions(filtered);
      pickerDropdown.classList.remove("hidden");
    };

    const closePicker = () => {
      pickerDropdown.classList.add("hidden");
    };

    const selectCountry = (code) => {
      this.selectedCountry = code;
      localStorage.setItem("selectedCountry", code);
      if (code) {
        pickerInput.value = this.getCountryName(code);
        pickerFlag.src = Stats.getFlagUrl(code);
        pickerFlag.classList.remove("hidden");
        pickerFlag.style.display = "";
        pickerClear.classList.remove("hidden");
      } else {
        pickerInput.value = "";
        pickerFlag.classList.add("hidden");
        pickerClear.classList.add("hidden");
      }
      closePicker();
      rerender();
    };

    pickerInput.addEventListener("focus", () => {
      pickerInput.select();
      openPicker();
    });

    pickerInput.addEventListener("input", () => {
      const query = pickerInput.value.toLowerCase();
      const filtered = (this.countryList || []).filter((code) => {
        const name = this.getCountryName(code).toLowerCase();
        return name.includes(query) || code.includes(query);
      });
      this.renderCountryOptions(filtered);
      if (pickerDropdown.classList.contains("hidden")) {
        pickerDropdown.classList.remove("hidden");
      }
    });

    pickerClear.addEventListener("click", (e) => {
      e.stopPropagation();
      selectCountry("");
      pickerInput.focus();
    });

    pickerOptions.addEventListener("click", (e) => {
      const option = e.target.closest(".country-option");
      if (!option) return;
      selectCountry(option.dataset.value);
    });

    // Close picker on click outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#country-picker")) {
        closePicker();
        // If user typed something that doesn't match, restore previous value
        if (this.selectedCountry) {
          pickerInput.value = this.getCountryName(this.selectedCountry);
        } else {
          pickerInput.value = "";
        }
      }
    });

    // Close picker on ESC
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !pickerDropdown.classList.contains("hidden")) {
        closePicker();
        pickerInput.blur();
        if (this.selectedCountry) {
          pickerInput.value = this.getCountryName(this.selectedCountry);
        } else {
          pickerInput.value = "";
        }
      }
    });
  },

  /**
   * Setup expand/compact toggle for leaderboard
   */
  setupExpandToggle() {
    const toggle = document.getElementById("expand-toggle");
    const app = document.querySelector(".app");

    toggle.addEventListener("click", () => {
      const isNowCompact = app.classList.toggle("compact");
      toggle.innerHTML = isNowCompact
        ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>'
        : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>';
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

// Export for use in other modules
window.App = App;

// Start the app when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
