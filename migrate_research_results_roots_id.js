/**
 * migrate_research_results_roots_id.js
 *
 * Standalone migration: ensures `productid` exists on `research_results`,
 * loads `Full-Roots.json` and `ai_to_full_roots_mappings.json`,
 * maps all existing `root_name` records to their corresponding ID (falling back to 0),
 * and updates `productid` in bulk using optimized batch grouping.
 *
 * Run once:
 *   node migrate_research_results_roots_id.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { sequelize } = require('./models/all');

const FULL_ROOTS_FILE = path.join(__dirname, 'Full-Roots.json');
const AI_TO_FULL_MAPPINGS_FILE = path.join(__dirname, 'ai_to_full_roots_mappings.json');

async function run() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database.');

    // 1. Ensure the `productId` column exists in the database.
    await sequelize.query(`
      ALTER TABLE research_results
      ADD COLUMN IF NOT EXISTS "productId" INTEGER;
    `);
    console.log('✅ Column `productId` is ready in `research_results` table.');

    // 2. Load indexes
    const fullRootsIndex = new Map();
    if (fs.existsSync(FULL_ROOTS_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(FULL_ROOTS_FILE, 'utf8'));
        for (const item of data) {
          if (item.id) {
            const targetId = parseInt(item.id, 10) || 0;
            if (item.Root) fullRootsIndex.set(item.Root.toLowerCase().trim(), targetId);
            if (item.name_en) fullRootsIndex.set(item.name_en.toLowerCase().trim(), targetId);
            if (item['Best MeSH match']) fullRootsIndex.set(item['Best MeSH match'].toLowerCase().trim(), targetId);
          }
        }
        console.log(`📂 Loaded ${fullRootsIndex.size} root entries indexed from Full-Roots.json`);
      } catch (e) {
        console.error("⚠️ Error loading Full-Roots.json:", e);
      }
    } else {
      console.warn("⚠️ Full-Roots.json not found!");
    }

    let aiToFullMappings = {};
    if (fs.existsSync(AI_TO_FULL_MAPPINGS_FILE)) {
      try {
        aiToFullMappings = JSON.parse(fs.readFileSync(AI_TO_FULL_MAPPINGS_FILE, 'utf8'));
        console.log(`📂 Loaded ${Object.keys(aiToFullMappings).length} mappings from ai_to_full_roots_mappings.json`);
      } catch (e) {
        console.error("⚠️ Error loading ai_to_full_roots_mappings.json:", e);
      }
    } else {
      console.warn("⚠️ ai_to_full_roots_mappings.json not found!");
    }

    // 3. First, set "productId" = 0 for all null/empty/invalid root_name records
    console.log('🔄 Updating invalid/empty root names to "productId" = 0...');
    const [_, invalidRowsUpdated] = await sequelize.query(`
      UPDATE research_results
      SET "productId" = 0
      WHERE root_name IS NULL 
         OR root_name = '' 
         OR root_name = 'null' 
         OR root_name = 'None'
    `, { type: sequelize.QueryTypes.UPDATE });
    console.log(`✅ Set "productId" = 0 for ${invalidRowsUpdated || 0} records with invalid/empty root names.`);

    // 4. Fetch all unique root_name values currently in research_results (excluding invalid/empty ones)
    const distinctRoots = await sequelize.query(`
      SELECT DISTINCT root_name 
      FROM research_results
      WHERE root_name IS NOT NULL 
        AND root_name != '' 
        AND root_name != 'null' 
        AND root_name != 'None'
    `, { type: sequelize.QueryTypes.SELECT });

    console.log(`🔍 Found ${distinctRoots.length} distinct valid root names to process.`);

    // 5. Group root names by targetId
    const targetGroups = new Map(); // targetId -> Array of rootNameRaw
    let mappedCount = 0;
    let fallbackCount = 0;

    for (const row of distinctRoots) {
      const rootNameRaw = row.root_name;
      const cleanItemName = rootNameRaw.toLowerCase().trim();
      let targetId = 0;

      // Helper function to resolve target ID
      function findTargetId(name) {
        const mapping = aiToFullMappings[name];
        if (mapping && mapping.mapped && mapping.fullRootsRecord && mapping.fullRootsRecord.id) {
          return parseInt(mapping.fullRootsRecord.id, 10) || 0;
        }
        if (fullRootsIndex.has(name)) {
          return fullRootsIndex.get(name);
        }
        return 0;
      }

      targetId = findTargetId(cleanItemName);

      // Fallback to singular forms for plurals (e.g. apples -> apple, berries -> berry)
      if (targetId === 0) {
        let singular = cleanItemName;
        if (cleanItemName.endsWith('ies')) {
          singular = cleanItemName.slice(0, -3) + 'y';
        } else if (cleanItemName.endsWith('es')) {
          const test1 = cleanItemName.slice(0, -2);
          const test2 = cleanItemName.slice(0, -1);
          if (findTargetId(test1) > 0) singular = test1;
          else if (findTargetId(test2) > 0) singular = test2;
        } else if (cleanItemName.endsWith('s') && !cleanItemName.endsWith('ss')) {
          singular = cleanItemName.slice(0, -1);
        }

        if (singular !== cleanItemName) {
          targetId = findTargetId(singular);
          if (targetId > 0) {
            console.log(`   ℹ️ Plural fallback matched: "${cleanItemName}" matched as singular "${singular}" -> Product ID ${targetId}`);
          }
        }
      }

      if (targetId > 0) {
        mappedCount++;
      } else {
        fallbackCount++;
      }

      if (!targetGroups.has(targetId)) {
        targetGroups.set(targetId, []);
      }
      targetGroups.get(targetId).push(rootNameRaw);
    }

    console.log(`📦 Grouped distinct root names into ${targetGroups.size} target ID groups.`);

    let totalUpdatedRows = 0;

    // 6. Update database in batches per target ID group
    for (const [targetId, rootNames] of targetGroups.entries()) {
      const BATCH_SIZE = 200;
      let groupUpdated = 0;

      for (let i = 0; i < rootNames.length; i += BATCH_SIZE) {
        const batch = rootNames.slice(i, i + BATCH_SIZE);
        const batchLower = batch.map(name => name.toLowerCase());

        const [_, rowsAffected] = await sequelize.query(`
          UPDATE research_results
          SET "productId" = :targetId
          WHERE LOWER(root_name) IN (:batchLower)
        `, {
          replacements: {
            targetId: targetId,
            batchLower: batchLower
          },
          type: sequelize.QueryTypes.UPDATE
        });

        const affected = parseInt(rowsAffected, 10) || 0;
        groupUpdated += affected;
        totalUpdatedRows += affected;
      }

      console.log(`  🔄 Mapped ${rootNames.length} root names to productId: ${targetId} (${groupUpdated} rows updated in DB)`);
    }

    console.log('\n========================================');
    console.log(`✅ Backfill migration complete.`);
    console.log(`   Total distinct roots processed: ${distinctRoots.length}`);
    console.log(`   Distinct roots successfully mapped (ID > 0): ${mappedCount}`);
    console.log(`   Distinct roots defaulted to 0: ${fallbackCount}`);
    console.log(`   Total database rows updated: ${totalUpdatedRows}`);
    console.log('========================================');

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
    console.log('🔒 DB connection closed.');
  }
}

run();
