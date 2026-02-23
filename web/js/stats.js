/**
 * Stats calculation module
 * Calculates winners, losers, and other interesting statistics
 */

const Stats = {
  /**
   * Filter snapshots to only include those within a time period
   * @param {Array} snapshots - All snapshots
   * @param {number} days - Number of days to include (0 = all time)
   */
  filterSnapshotsByTime(snapshots, days) {
    if (days === 0 || !snapshots.length) return snapshots;

    const now = new Date();
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    return snapshots.filter((s) => new Date(s.timestamp) >= cutoff);
  },

  /**
   * Generate a unique player ID
   * Uses name|country only (not team) so team changes don't split history
   */
  getPlayerId(player) {
    return player.id || `${player.name}|${player.country || ""}`;
  },

  /**
   * Build a map of player history across all snapshots
   * Returns: { playerId: [{ timestamp, rank }, ...] }
   * @param {Array} snapshots - Snapshots to process
   * @param {number} timeDays - Number of days to include (0 = all time)
   */
  buildPlayerHistory(snapshots, timeDays = 0) {
    const filteredSnapshots = this.filterSnapshotsByTime(snapshots, timeDays);
    const history = {};

    for (const snapshot of filteredSnapshots) {
      for (const player of snapshot.players) {
        const playerId = this.getPlayerId(player);
        if (!history[playerId]) {
          history[playerId] = {
            id: playerId,
            name: player.name,
            team_tag: player.team_tag,
            team_id: player.team_id,
            country: player.country,
            ranks: [],
          };
        }

        history[playerId].ranks.push({
          timestamp: snapshot.timestamp,
          rank: player.rank,
        });

        // Update to latest values (including null for team if player left)
        history[playerId].team_tag = player.team_tag || null;
        history[playerId].team_id = player.team_id || null;
        if (player.country) {
          history[playerId].country = player.country;
        }
      }
    }

    return history;
  },

  /**
   * Calculate biggest winners (rank improvements)
   * @param {Object} playerHistory - Player history data
   * @param {number} count - Number of results to return
   * @param {number} scope - Only include players whose current rank is within this scope
   * @param {number} timeDays - Time period in days (0 = all time)
   * @param {Array} snapshots - Original snapshots for time filtering
   */
  getWinners(
    playerHistory,
    count = 5,
    scope = 500,
    timeDays = 0,
    snapshots = null,
  ) {
    // If time filter is specified, rebuild history with filtered snapshots
    const history =
      timeDays > 0 && snapshots
        ? this.buildPlayerHistory(snapshots, timeDays)
        : playerHistory;
    const changes = [];

    for (const [id, data] of Object.entries(history)) {
      if (data.ranks.length < 2) continue;

      const firstRank = data.ranks[0].rank;
      const lastRank = data.ranks[data.ranks.length - 1].rank;

      // Filter by scope - only include players currently in the scope
      if (lastRank > scope) continue;

      const change = firstRank - lastRank; // Positive = improved (lower rank is better)

      if (change > 0) {
        changes.push({
          id,
          name: data.name,
          team_tag: data.team_tag,
          country: data.country,
          firstRank,
          lastRank,
          change,
        });
      }
    }

    return changes.sort((a, b) => b.change - a.change).slice(0, count);
  },

  /**
   * Calculate biggest losers (rank drops)
   * @param {Object} playerHistory - Player history data
   * @param {number} count - Number of results to return
   * @param {number} scope - Only include players whose current rank is within this scope
   * @param {number} timeDays - Time period in days (0 = all time)
   * @param {Array} snapshots - Original snapshots for time filtering
   */
  getLosers(
    playerHistory,
    count = 5,
    scope = 500,
    timeDays = 0,
    snapshots = null,
  ) {
    // If time filter is specified, rebuild history with filtered snapshots
    const history =
      timeDays > 0 && snapshots
        ? this.buildPlayerHistory(snapshots, timeDays)
        : playerHistory;
    const changes = [];

    for (const [id, data] of Object.entries(history)) {
      if (data.ranks.length < 2) continue;

      const firstRank = data.ranks[0].rank;
      const lastRank = data.ranks[data.ranks.length - 1].rank;

      // Filter by scope - only include players currently in the scope
      if (lastRank > scope) continue;

      const change = lastRank - firstRank; // Positive = dropped (higher rank is worse)

      if (change > 0) {
        changes.push({
          id,
          name: data.name,
          team_tag: data.team_tag,
          country: data.country,
          firstRank,
          lastRank,
          change,
        });
      }
    }

    return changes.sort((a, b) => b.change - a.change).slice(0, count);
  },

  /**
   * Get general statistics
   */
  getGeneralStats(snapshots, playerHistory) {
    const firstSnapshot = snapshots[0];
    const lastSnapshot = snapshots[snapshots.length - 1];

    const firstPlayers = new Set(firstSnapshot.players.map((p) => p.name));
    const lastPlayers = new Set(lastSnapshot.players.map((p) => p.name));

    // New entries (in last but not in first)
    const newEntries = [...lastPlayers].filter((p) => !firstPlayers.has(p));

    // Dropped out (in first but not in last)
    const droppedOut = [...firstPlayers].filter((p) => !lastPlayers.has(p));

    // Most volatile (biggest total movement)
    const volatility = [];
    for (const [name, data] of Object.entries(playerHistory)) {
      if (data.ranks.length < 2) continue;

      let totalMovement = 0;
      for (let i = 1; i < data.ranks.length; i++) {
        totalMovement += Math.abs(data.ranks[i].rank - data.ranks[i - 1].rank);
      }

      volatility.push({ name, totalMovement, team_tag: data.team_tag });
    }

    const mostVolatile = volatility
      .sort((a, b) => b.totalMovement - a.totalMovement)
      .slice(0, 3);

    return {
      totalSnapshots: snapshots.length,
      newEntries: newEntries.length,
      droppedOut: droppedOut.length,
      mostVolatile,
      dateRange: {
        from: firstSnapshot.timestamp,
        to: lastSnapshot.timestamp,
      },
    };
  },

  /**
   * Get detailed stats for a specific player by ID
   */
  getPlayerStats(playerHistory, playerId) {
    const data = playerHistory[playerId];
    if (!data || data.ranks.length === 0) return null;

    const ranks = data.ranks.map((r) => r.rank);
    const timestamps = data.ranks.map((r) => r.timestamp);

    const currentRank = ranks[ranks.length - 1];
    const bestRank = Math.min(...ranks);
    const worstRank = Math.max(...ranks);
    const avgRank = Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length);

    const firstRank = ranks[0];
    const totalChange = firstRank - currentRank; // Positive = improved

    // Find biggest single jump
    let biggestJump = { change: 0, from: 0, to: 0 };
    for (let i = 1; i < ranks.length; i++) {
      const change = Math.abs(ranks[i] - ranks[i - 1]);
      if (change > Math.abs(biggestJump.change)) {
        biggestJump = {
          change: ranks[i - 1] - ranks[i],
          from: ranks[i - 1],
          to: ranks[i],
        };
      }
    }

    return {
      id: playerId,
      name: data.name,
      team_tag: data.team_tag,
      country: data.country,
      currentRank,
      bestRank,
      worstRank,
      avgRank,
      totalChange,
      biggestJump,
      ranks,
      timestamps,
    };
  },

  /**
   * Get country flag URL
   */
  getFlagUrl(country) {
    if (!country) return null;
    return `https://community.fastly.steamstatic.com/public/images/countryflags/${country.toLowerCase()}.gif`;
  },

  /**
   * Detect team changes within a time period
   * @param {Array} snapshots - All snapshots
   * @param {number} timeDays - Time period in days
   * @returns {Array} Array of team change events
   */
  getTeamChanges(snapshots, timeDays = 0) {
    const filteredSnapshots = this.filterSnapshotsByTime(snapshots, timeDays);
    if (filteredSnapshots.length < 2) return [];

    // Track each player's team over time
    const playerTeams = {}; // playerId -> { firstTeam, firstTimestamp, lastTeam, lastTimestamp, name, country }

    for (const snapshot of filteredSnapshots) {
      for (const player of snapshot.players) {
        const playerId = this.getPlayerId(player);
        const teamTag = player.team_tag || null;

        if (!playerTeams[playerId]) {
          playerTeams[playerId] = {
            name: player.name,
            country: player.country,
            rank: player.rank,
            firstTeam: teamTag,
            firstTimestamp: snapshot.timestamp,
            lastTeam: teamTag,
            lastTimestamp: snapshot.timestamp,
          };
        } else {
          playerTeams[playerId].lastTeam = teamTag;
          playerTeams[playerId].lastTimestamp = snapshot.timestamp;
          playerTeams[playerId].rank = player.rank;
          // Update name/country to latest
          playerTeams[playerId].name = player.name;
          if (player.country) playerTeams[playerId].country = player.country;
        }
      }
    }

    // Find players whose team changed
    const changes = [];
    for (const [playerId, data] of Object.entries(playerTeams)) {
      if (data.firstTeam !== data.lastTeam) {
        changes.push({
          id: playerId,
          name: data.name,
          country: data.country,
          rank: data.rank,
          fromTeam: data.firstTeam,
          toTeam: data.lastTeam,
          timestamp: data.lastTimestamp,
        });
      }
    }

    // Sort by most recent change
    changes.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return changes;
  },

  /**
   * Get full team history for a specific player
   * @param {Array} snapshots - All snapshots
   * @param {string} playerId - Player ID to look up
   * @returns {Array} Array of team states with timestamps
   */
  getPlayerTeamHistory(snapshots, playerId) {
    const teamHistory = [];
    let currentTeam = undefined; // Track current team to detect changes

    for (const snapshot of snapshots) {
      const player = snapshot.players.find(
        (p) => this.getPlayerId(p) === playerId,
      );
      if (!player) continue;

      const teamTag = player.team_tag || null;

      // Only record when team changes (or first appearance)
      if (teamTag !== currentTeam) {
        teamHistory.push({
          team: teamTag,
          timestamp: snapshot.timestamp,
        });
        currentTeam = teamTag;
      }
    }

    return teamHistory;
  },
};
// Export for use in other modules
window.Stats = Stats;
