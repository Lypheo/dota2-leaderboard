#!/usr/bin/env node

/**
 * Extract leaderboard history from daily snapshot files
 *
 * Reads from: data/snapshots/europe/YYYY-MM-DD.json
 * Outputs:    web/data/history-europe.json (compact columnar format)
 *
 * The compact format stores player metadata once and uses arrays indexed by
 * date for ranks and run-length-encoded team history, dramatically reducing
 * file size compared to the old per-snapshot-repeated-objects format.
 */

const fs = require("fs");
const path = require("path");

// Configuration
const CONFIG = {
  SNAPSHOTS_DIR: "data/snapshots/europe",
  OUTPUT_DIR: "web/data",
  OUTPUT_FILE: "history-europe.json",
};

/**
 * Read all snapshot files from disk, sorted chronologically
 * @returns {Array<{date: string, players: Array}>}
 */
function readSnapshots() {
  const snapshotsDir = CONFIG.SNAPSHOTS_DIR;

  if (!fs.existsSync(snapshotsDir)) {
    console.error(`Snapshots directory not found: ${snapshotsDir}`);
    return [];
  }

  const files = fs
    .readdirSync(snapshotsDir)
    .filter((f) => f.endsWith(".json"))
    .sort(); // YYYY-MM-DD.json sorts chronologically

  console.log(`Found ${files.length} snapshot files`);

  const snapshots = [];

  for (const file of files) {
    const date = file.replace(".json", "");
    const filePath = path.join(snapshotsDir, file);

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      let players = JSON.parse(content);

      if (!Array.isArray(players) || players.length === 0) {
        console.warn(`  ⚠️ Skipping empty snapshot: ${file}`);
        continue;
      }

      // Normalize: handle tuple format [name, country, team]
      // and legacy object formats {r,n,t,i,c} / {rank,name,...}
      players = players.slice(0, 5000).map((p, idx) => {
        if (Array.isArray(p)) {
          return {
            rank: idx + 1,
            name: p[0],
            country: p[1] || null,
            team_tag: p[2] || null,
          };
        }
        return {
          rank: p.r ?? p.rank ?? (idx + 1),
          name: p.n ?? p.name,
          team_tag: p.t ?? p.team_tag ?? null,
          country: p.c ?? p.country ?? null,
        };
      });

      snapshots.push({ date, players });
    } catch (error) {
      console.warn(`  ⚠️ Failed to parse ${file}: ${error.message}`);
    }
  }

  return snapshots;
}

/**
 * Resolve player identities across snapshots.
 *
 * The API has no player IDs. We use name|country as the key, but when a player
 * changes country they appear as a "new" player. This function detects such
 * changes by looking for a name that disappeared with one country and appeared
 * with another in the same snapshot.
 *
 * @param {Array} snapshots - Chronologically sorted snapshots
 * @returns {{idMap: Object, aliases: Object}} Maps for ID resolution
 */
function resolveIdentities(snapshots) {
  // canonicalIds: current name|country -> stable ID
  // aliases: all historical name|country -> stable ID
  const canonicalIds = {};
  const aliases = {};
  let mergeCount = 0;

  for (const snapshot of snapshots) {
    const currentCombos = new Set(
      snapshot.players.map((p) => `${p.name}|${p.country || ""}`),
    );

    const unresolved = [];

    // First pass: assign known IDs
    for (const player of snapshot.players) {
      const combo = `${player.name}|${player.country || ""}`;
      if (canonicalIds[combo]) {
        player.id = canonicalIds[combo];
      } else if (aliases[combo]) {
        player.id = aliases[combo];
        canonicalIds[combo] = aliases[combo];
      } else {
        unresolved.push(player);
      }
    }

    // Second pass: detect country changes
    for (const player of unresolved) {
      const combo = `${player.name}|${player.country || ""}`;
      const name = player.name;

      const disappeared = Object.entries(canonicalIds).filter(([nc]) => {
        const ncName = nc.substring(0, nc.lastIndexOf("|"));
        return ncName === name && !currentCombos.has(nc);
      });

      if (disappeared.length === 1) {
        const [oldCombo, stableId] = disappeared[0];
        player.id = stableId;
        delete canonicalIds[oldCombo];
        canonicalIds[combo] = stableId;
        aliases[oldCombo] = stableId;
        aliases[combo] = stableId;
        mergeCount++;
        console.log(
          `  🔗 Merged identity: ${oldCombo} → ${combo} (ID: ${stableId})`,
        );
      } else {
        canonicalIds[combo] = combo;
        aliases[combo] = combo;
        player.id = combo;
      }
    }
  }

  console.log(`  Merged ${mergeCount} identity change(s)`);
  return { canonicalIds, aliases };
}

/**
 * Build compact columnar history from snapshots.
 *
 * Output format:
 * {
 *   region: "europe",
 *   dates: ["2026-01-01", ...],
 *   players: {
 *     "playerId": {
 *       n: "PlayerName",
 *       c: "de",
 *       r: [1, 2, null, ...],       // rank per date index, null = absent
 *       th: [["OG", 0], ...]          // [team_tag, startDateIndex]
 *     }
 *   },
 *   aliases: { "name|newcountry": "name|oldcountry" },
 *   meta: { ... }
 * }
 */
function buildCompactHistory(snapshots, aliases) {
  const dates = snapshots.map((s) => s.date);
  const players = {};

  for (let dateIdx = 0; dateIdx < snapshots.length; dateIdx++) {
    const snapshot = snapshots[dateIdx];

    for (const player of snapshot.players) {
      const id = player.id;

      if (!players[id]) {
        players[id] = {
          n: player.name,
          c: player.country,
          r: new Array(snapshots.length).fill(null),
          th: [], // team history: [team_tag, startDateIndex]
        };
      }

      const p = players[id];
      p.r[dateIdx] = player.rank;

      // Update name/country to latest
      if (player.name) p.n = player.name;
      if (player.country) p.c = player.country;

      // Track team changes
      const currentTeam = player.team_tag || null;
      const lastTeamEntry = p.th[p.th.length - 1];

      if (!lastTeamEntry || lastTeamEntry[0] !== currentTeam) {
        p.th.push([currentTeam, dateIdx]);
      }
    }
  }

  // Trim trailing nulls from rank arrays to save space
  for (const p of Object.values(players)) {
    while (p.r.length > 0 && p.r[p.r.length - 1] === null) {
      p.r.pop();
    }
  }

  // Filter aliases to only include actual remaps
  const usefulAliases = {};
  for (const [combo, stableId] of Object.entries(aliases)) {
    if (combo !== stableId) {
      usefulAliases[combo] = stableId;
    }
  }

  return {
    region: "europe",
    dates,
    players,
    aliases: usefulAliases,
    meta: {
      generatedAt: new Date().toISOString(),
      totalSnapshots: snapshots.length,
      totalPlayers: Object.keys(players).length,
      dateRange: {
        from: dates[0],
        to: dates[dates.length - 1],
      },
    },
  };
}

/**
 * Main extraction function
 */
function main() {
  console.log("🌍 Processing EUROPE region...\n");

  // Read snapshots
  const snapshots = readSnapshots();

  if (snapshots.length === 0) {
    console.warn("⚠️ No snapshots found. Nothing to extract.");
    process.exit(0);
  }

  console.log(
    `📅 Date range: ${snapshots[0].date} to ${snapshots[snapshots.length - 1].date}`,
  );

  // Resolve identities
  console.log("\n🔗 Resolving player identities...");
  const { aliases } = resolveIdentities(snapshots);

  // Build compact history
  console.log("\n📦 Building compact history...");
  const history = buildCompactHistory(snapshots, aliases);

  // Ensure output directory exists
  const outputDir = CONFIG.OUTPUT_DIR;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write output
  const outputPath = path.join(outputDir, CONFIG.OUTPUT_FILE);
  const json = JSON.stringify(history);
  fs.writeFileSync(outputPath, json);

  const fileSizeKB = (Buffer.byteLength(json) / 1024).toFixed(1);
  const fileSizeMB = (Buffer.byteLength(json) / (1024 * 1024)).toFixed(2);
  console.log(
    `\n💾 Written to ${outputPath} (${fileSizeKB} KB / ${fileSizeMB} MB)`,
  );
  console.log(`   ${history.meta.totalSnapshots} snapshots`);
  console.log(`   ${history.meta.totalPlayers} unique players`);
  console.log(
    `   ${Object.keys(history.aliases).length} identity aliases`,
  );
  console.log("\n✅ Done!");
}

main();
