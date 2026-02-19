#!/usr/bin/env node

/**
 * Extract leaderboard history from git commits
 *
 * Outputs a history JSON file for each region to web/data/:
 *   - history-americas.json
 *   - history-europe.json
 *   - history-sea.json
 *   - history-china.json
 *
 * These files are loaded by the web app based on the selected region.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Configuration
const CONFIG = {
  MAX_DAYS: 140, // How many days of history to include
  MAX_SNAPSHOTS: 3360, // Maximum snapshots (140 days * 24 hours)
  REGIONS: [
    { id: "europe", file: "leaderboard/europe.json" },
    { id: "americas", file: "leaderboard/americas.json" },
    { id: "sea", file: "leaderboard/sea.json" },
    { id: "china", file: "leaderboard/china.json" },
  ],
  OUTPUT_DIR: "web/data",
};

/**
 * Execute a git command and return the output
 */
function git(command) {
  try {
    return execSync(`git ${command}`, {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (error) {
    console.error(`Git command failed: git ${command}`);
    console.error(error.message);
    return null;
  }
}

/**
 * Get all commits that modified a leaderboard file
 */
function getLeaderboardCommits(leaderboardFile) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CONFIG.MAX_DAYS);
  const since = cutoffDate.toISOString().split("T")[0];

  // Get commits with hash, date, and message
  const log = git(
    `log --since="${since}" --format="%H|%aI|%s" -- "${leaderboardFile}"`,
  );

  if (!log) return [];

  const commits = log
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, date, ...messageParts] = line.split("|");
      const message = messageParts.join("|");

      // Try to parse timestamp from commit message (format: "update leaderboard data - 2026-01-16 11:31 UTC")
      let timestamp = date;
      const match = message.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*UTC/);
      if (match) {
        timestamp = new Date(match[1] + " UTC").toISOString();
      }

      return {
        hash,
        timestamp,
        message,
      };
    });

  return commits;
}

/**
 * Get the leaderboard content at a specific commit
 */
function getLeaderboardAtCommit(commitHash, leaderboardFile) {
  const content = git(`show ${commitHash}:"${leaderboardFile}"`);
  if (!content) return null;

  try {
    let players = JSON.parse(content);

    // Skip empty snapshots
    if (!players || players.length === 0) {
      console.log(`  Skipping empty snapshot at ${commitHash}`);
      return null;
    }

    // Crop to top 500 players (old format had 5000+)
    if (players.length > 500) {
      players = players.slice(0, 500);
    }

    // Only keep necessary fields to reduce file size
    // ID uses name|country only (not team) so team changes don't split history
    return players.map((p) => ({
      id: `${p.name}|${p.country || ""}`,
      rank: p.rank,
      name: p.name,
      team_tag: p.team_tag || null,
      team_id: p.team_id || null,
      country: p.country || null,
    }));
  } catch (error) {
    console.error(`Failed to parse JSON at commit ${commitHash}`);
    return null;
  }
}

/**
 * Resolve player identities across snapshots.
 *
 * Problem: The API has no player IDs. We use name|country as key, but when a
 * player changes country, they appear as a "new" player and their history splits.
 *
 * Solution: Process snapshots chronologically and detect country changes.
 * When a name|country combo appears that we haven't seen before, check if
 * exactly ONE previously-known player with the same name "disappeared" from
 * the current snapshot. If so, it's a country change — keep the same stable ID.
 *
 * Edge cases handled:
 * - Two players with the same name (different countries): kept separate
 * - Ambiguous merges (2+ same-name players disappeared): treated as new (safe)
 * - Team changes: don't affect identity (team is not part of the key)
 *
 * @param {Array} snapshots - Snapshots in chronological order (oldest first)
 * @returns {number} Number of identity merges performed
 */
function resolvePlayerIdentities(snapshots) {
  // Maps current name|country combo to its canonical (stable) ID.
  // The canonical ID is the first-ever-seen name|country for that player.
  const canonicalIds = {}; // name|country -> stable ID
  let mergeCount = 0;

  for (const snapshot of snapshots) {
    // Collect all name|country combos present in this snapshot
    const currentCombos = new Set(
      snapshot.players.map((p) => `${p.name}|${p.country || ""}`),
    );

    // First pass: assign IDs to players with known name|country combos
    const unresolved = [];
    for (const player of snapshot.players) {
      const combo = `${player.name}|${player.country || ""}`;
      if (canonicalIds[combo]) {
        player.id = canonicalIds[combo];
      } else {
        unresolved.push(player);
      }
    }

    // Second pass: try to resolve unknown combos by detecting country changes
    for (const player of unresolved) {
      const combo = `${player.name}|${player.country || ""}`;
      const name = player.name;

      // Find registered players with the same name whose old name|country
      // combo is NOT in the current snapshot (they "disappeared")
      const disappeared = Object.entries(canonicalIds).filter(([nc]) => {
        const ncName = nc.substring(0, nc.lastIndexOf("|"));
        return ncName === name && !currentCombos.has(nc);
      });

      if (disappeared.length === 1) {
        // Exactly one player with this name disappeared → country change
        const [oldCombo, stableId] = disappeared[0];
        player.id = stableId;
        // Update registry: old combo no longer active, new combo points to same ID
        delete canonicalIds[oldCombo];
        canonicalIds[combo] = stableId;
        mergeCount++;
        console.log(
          `  🔗 Merged identity: ${oldCombo} → ${combo} (ID: ${stableId})`,
        );
      } else {
        // New player or ambiguous (multiple same-name players disappeared)
        canonicalIds[combo] = combo;
        player.id = combo;
      }
    }
  }

  return mergeCount;
}

/**
 * Sample commits if there are too many
 */
function sampleCommits(commits) {
  if (commits.length <= CONFIG.MAX_SNAPSHOTS) {
    return commits;
  }

  console.log(
    `Sampling ${CONFIG.MAX_SNAPSHOTS} commits from ${commits.length} total`,
  );

  const sampled = [];
  const step = commits.length / CONFIG.MAX_SNAPSHOTS;

  for (let i = 0; i < CONFIG.MAX_SNAPSHOTS; i++) {
    const index = Math.floor(i * step);
    sampled.push(commits[index]);
  }

  // Always include the most recent commit
  if (sampled[sampled.length - 1] !== commits[0]) {
    sampled[sampled.length - 1] = commits[0];
  }

  return sampled;
}

/**
 * Main extraction function
 */
async function extractHistory() {
  // Ensure output directory exists
  if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
    fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
  }

  // Process each region
  for (const region of CONFIG.REGIONS) {
    console.log(`\n🌍 Processing ${region.id.toUpperCase()} region...`);
    await extractRegionHistory(region);
  }

  console.log("\n✅ All regions processed!");
}

/**
 * Extract history for a single region
 */
async function extractRegionHistory(region) {
  console.log(`🔍 Finding ${region.id} leaderboard commits...`);

  let commits = getLeaderboardCommits(region.file);
  console.log(
    `Found ${commits.length} commits in the last ${CONFIG.MAX_DAYS} days`,
  );

  if (commits.length === 0) {
    console.warn(`⚠️ No commits found for ${region.id}, skipping...`);
    return;
  }

  // Sample if too many commits
  commits = sampleCommits(commits);

  console.log("📦 Extracting snapshots...");

  const snapshots = [];
  let processed = 0;

  // Process commits from oldest to newest
  for (const commit of commits.reverse()) {
    const players = getLeaderboardAtCommit(commit.hash, region.file);

    if (players) {
      snapshots.push({
        timestamp: commit.timestamp,
        commitHash: commit.hash.substring(0, 7),
        players,
      });
    }

    processed++;
    if (processed % 10 === 0) {
      console.log(`  Processed ${processed}/${commits.length} commits`);
    }
  }

  console.log(
    `✅ Extracted ${snapshots.length} valid snapshots for ${region.id}`,
  );

  if (snapshots.length === 0) {
    console.warn(`⚠️ No valid snapshots for ${region.id}, skipping...`);
    return;
  }

  // Resolve player identities across snapshots (handles country changes)
  console.log("🔗 Resolving player identities...");
  const mergeCount = resolvePlayerIdentities(snapshots);
  console.log(`  Merged ${mergeCount} identity change(s)`);

  // Build output
  const output = {
    region: region.id,
    snapshots,
    meta: {
      generatedAt: new Date().toISOString(),
      totalSnapshots: snapshots.length,
      dateRange: {
        from: snapshots[0]?.timestamp,
        to: snapshots[snapshots.length - 1]?.timestamp,
      },
    },
  };

  // Write output
  const outputPath = path.join(CONFIG.OUTPUT_DIR, `history-${region.id}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output));

  const fileSizeKB = (fs.statSync(outputPath).size / 1024).toFixed(1);
  console.log(`💾 Written to ${outputPath} (${fileSizeKB} KB)`);
}

// Run
extractHistory().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
