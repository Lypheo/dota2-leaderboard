/**
 * Main application entry point
 * Coordinates all modules and handles data loading
 */

const App = {
  data: null,
  playerHistory: null,
  playerLookupList: [],
  playerLookupResults: [],
  playerLookupQuery: "",
  playerLookupMaxResults: 20,
  playerLookupDebounceMs: 150,

  // Global filter state
  prosOnly: false,
  selectedCountry: "",

  /**
   * Initialize the application
   */
  async init() {
    try {
      // Initialize favorites
      Favorites.init();

      // Load data
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
      this.setupPlayerLookup();
      this.setupExpandToggle();
      this.setupTeamChangesToggle();

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
    } catch (error) {
      console.error("Failed to initialize app:", error);
      document.getElementById("loading").classList.add("hidden");
      document.getElementById("error").classList.remove("hidden");
    }
  },

  /**
   * Load history data from compact JSON format and convert to snapshots
   */
  async loadData() {
    const response = await fetch("data/history-europe.json");
    if (!response.ok) {
      throw new Error(`Failed to load data: ${response.status}`);
    }

    const compact = await response.json();

    // Convert compact columnar format to snapshot format expected by modules
    this.data = this.convertCompactToSnapshots(compact);

    // Store aliases for favorite migration
    this._aliases = compact.aliases || {};

    if (!this.data.snapshots || this.data.snapshots.length === 0) {
      throw new Error("No snapshots in data");
    }

    console.log(`Loaded ${this.data.snapshots.length} snapshots`);
    console.log(
      `Date range: ${this.data.snapshots[0].timestamp} to ${
        this.data.snapshots[this.data.snapshots.length - 1].timestamp
      }`,
    );

    // Build player history for stats
    this.playerHistory = Stats.buildPlayerHistory(this.data.snapshots);

    // Build player lookup list for search
    this.buildPlayerLookupList();

    // Migrate favorites that reference old name|country IDs
    this.migrateFavorites();
  },

  /**
   * Convert compact columnar format to the snapshot-based format
   * expected by the existing Leaderboard/Timeline/Stats modules.
   *
   * Compact format: { dates, players: { id: { n, c, r: [...], th: [...] } } }
   * Output format:  { region, snapshots: [{ timestamp, players: [...] }], meta }
   */
  convertCompactToSnapshots(compact) {
    const snapshots = [];

    for (let i = 0; i < compact.dates.length; i++) {
      const players = [];

      for (const [id, p] of Object.entries(compact.players)) {
        const rank = i < p.r.length ? p.r[i] : null;
        if (rank === null) continue;

        // Find team at this date index from team history
        let team_tag = null;
        if (p.th && p.th.length > 0) {
          for (let t = p.th.length - 1; t >= 0; t--) {
            if (p.th[t][1] <= i) {
              team_tag = p.th[t][0];
              break;
            }
          }
        }

        players.push({
          id,
          rank,
          name: p.n,
          team_tag,
          country: p.c,
        });
      }

      players.sort((a, b) => a.rank - b.rank);

      snapshots.push({
        timestamp: compact.dates[i] + "T12:00:00Z",
        players,
      });
    }

    return {
      region: compact.region || "europe",
      snapshots,
      meta: compact.meta,
    };
  },

  /**
   * Migrate favorites that reference old name|country IDs.
   * Uses aliases from the compact history to find canonical IDs.
   */
  migrateFavorites() {
    const favoriteIds = Favorites.getAll();
    if (favoriteIds.length === 0) return;

    const aliases = this._aliases || {};

    for (const favId of favoriteIds) {
      if (!this.playerHistory[favId] && aliases[favId]) {
        console.log(`Migrating favorite: ${favId} → ${aliases[favId]}`);
        Favorites.remove(favId);
        Favorites.add(aliases[favId]);
      }
    }
  },

  /**
   * Build player lookup list from full history
   */
  buildPlayerLookupList() {
    if (!this.data?.snapshots?.length || !this.playerHistory) {
      this.playerLookupList = [];
      return;
    }

    const latestSnapshot = this.data.snapshots[this.data.snapshots.length - 1];
    const activeIds = new Set(
      latestSnapshot.players.map((player) => Stats.getPlayerId(player)),
    );

    this.playerLookupList = Object.values(this.playerHistory)
      .map((data) => {
        const lastEntry = data.ranks[data.ranks.length - 1];
        const name = data.name || "";
        const teamTag = data.team_tag || "";
        return {
          id: data.id,
          name,
          team_tag: teamTag,
          country: data.country,
          lastRank: lastEntry?.rank ?? null,
          lastTimestamp: lastEntry?.timestamp ?? null,
          isCurrent: activeIds.has(data.id),
          searchText: `${name} ${teamTag}`.toLowerCase(),
        };
      })
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
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
   * Render player lookup options
   */
  renderPlayerLookupOptions(results) {
    const optionsContainer = document.getElementById("player-lookup-options");
    if (!optionsContainer) return;

    if (!results.length) {
      optionsContainer.innerHTML =
        '<div class="player-option empty">No players found</div>';
      return;
    }

    optionsContainer.innerHTML = results
      .map((player) => {
        const flagUrl = Stats.getFlagUrl(player.country);
        const flagHtml = flagUrl
          ? `<img class="player-flag" src="${flagUrl}" alt="${
              player.country
            }" title="${
              player.country?.toUpperCase() || ""
            }" onerror="this.style.display='none'">`
          : "";
        const teamHtml = player.team_tag
          ? `<span class="player-team">${this.escapeHtml(
              player.team_tag,
            )}.</span>`
          : "";
        const rankLabel = player.lastRank ? `#${player.lastRank}` : "—";
        const dateLabel =
          !player.isCurrent && player.lastTimestamp
            ? `(${this.formatLookupDate(player.lastTimestamp)})`
            : "";
        const metaLabel = player.isCurrent
          ? `${rankLabel}`
          : `Last seen ${rankLabel}${dateLabel}`;
        const statusClass = player.isCurrent ? "" : " inactive";

        return `
          <div class="player-option${statusClass}" data-player-id="${this.escapeAttr(
            player.id,
          )}">
            ${flagHtml}
            <span class="player-option-name">${teamHtml}${this.escapeHtml(
              player.name,
            )}</span>
            <span class="player-option-meta">${metaLabel}</span>
          </div>
        `;
      })
      .join("");
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
   * Setup player lookup search
   */
  setupPlayerLookup() {
    const input = document.getElementById("player-lookup-input");
    const dropdown = document.getElementById("player-lookup-dropdown");
    const options = document.getElementById("player-lookup-options");
    const clearBtn = document.getElementById("player-lookup-clear");

    if (!input || !dropdown || !options) return;

    const openDropdown = () => dropdown.classList.remove("hidden");
    const closeDropdown = () => dropdown.classList.add("hidden");

    const maxResults = this.playerLookupMaxResults;
    const debounceMs = this.playerLookupDebounceMs;
    let debounceTimer = null;

    const updateResults = (force = false) => {
      const query = input.value.trim().toLowerCase();

      if (!query) {
        this.playerLookupResults = [];
        this.playerLookupQuery = "";
        closeDropdown();
        clearBtn.classList.add("hidden");
        return;
      }

      if (!force && query === this.playerLookupQuery) {
        openDropdown();
        clearBtn.classList.remove("hidden");
        return;
      }

      const results = this.playerLookupList
        .filter((player) => player.searchText.includes(query))
        .slice(0, maxResults);

      this.playerLookupResults = results;
      this.playerLookupQuery = query;
      this.renderPlayerLookupOptions(results);
      openDropdown();
      clearBtn.classList.remove("hidden");
    };

    const scheduleUpdate = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => updateResults(), debounceMs);
    };

    const selectPlayer = (playerId) => {
      closeDropdown();
      input.value = "";
      clearBtn.classList.add("hidden");
      this.playerLookupResults = [];
      this.playerLookupQuery = "";
      if (window.PlayerModal) {
        PlayerModal.show(playerId);
      }
    };

    input.addEventListener("focus", () => {
      if (input.value.trim()) {
        updateResults(false);
      }
    });

    input.addEventListener("input", scheduleUpdate);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.playerLookupResults.length > 0) {
        e.preventDefault();
        selectPlayer(this.playerLookupResults[0].id);
      } else if (e.key === "Escape") {
        closeDropdown();
        input.blur();
      }
    });

    clearBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      input.value = "";
      this.playerLookupResults = [];
      this.playerLookupQuery = "";
      closeDropdown();
      clearBtn.classList.add("hidden");
      input.focus();
    });

    options.addEventListener("click", (e) => {
      const option = e.target.closest(".player-option");
      if (!option || option.classList.contains("empty")) return;
      selectPlayer(option.dataset.playerId);
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest("#player-lookup")) {
        closeDropdown();
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
   * Format date for lookup list
   */
  formatLookupDate(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
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
