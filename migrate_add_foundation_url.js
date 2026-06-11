/**
 * migrate_add_foundation_url.js
 *
 * One-time migration: adds the `foundation_url` column to the `diseases` table
 * if it doesn't already exist, then populates it from icd11_disease_mappings.json.
 *
 * Run once:
 *   node migrate_add_foundation_url.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { sequelize, Disease } = require('./models/all');
const MAPPINGS_FILE = path.join(__dirname, 'icd11_disease_mappings.json');

async function run() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to DB');

    // 1. Add the columns if they don't exist yet (safe to run multiple times)
    await sequelize.query(`
      ALTER TABLE diseases
      ADD COLUMN IF NOT EXISTS foundation_url TEXT;
    `);
    await sequelize.query(`
      ALTER TABLE diseases
      ADD COLUMN IF NOT EXISTS icd_title TEXT;
    `);
    console.log('✅ Columns `foundation_url` and `icd_title` are ready in `diseases` table.');

    // 2. Load the ICD-11 mappings file
    if (!fs.existsSync(MAPPINGS_FILE)) {
      console.error('❌ icd11_disease_mappings.json not found. Run map_icd11_diseases.js first.');
      process.exit(1);
    }

    const mappings = JSON.parse(fs.readFileSync(MAPPINGS_FILE, 'utf8'));
    console.log(`📂 Loaded ${Object.keys(mappings).length} disease mappings from file.`);

    // 3. Update each matched disease row in the DB
    let updatedCount = 0;
    let skippedCount = 0;

    for (const [cleanName, match] of Object.entries(mappings)) {
      if (!match.mapped || !match.foundationUri) {
        skippedCount++;
        continue;
      }

      // Try to find by name (case-insensitive search)
      const [rowsAffected] = await sequelize.query(
        `UPDATE diseases
         SET foundation_url = :url,
             icd_title = :icdTitle
         WHERE LOWER(name) = LOWER(:name)
           AND (foundation_url IS NULL OR foundation_url = '')`,
        {
          replacements: {
            url: match.foundationUri,
            icdTitle: match.title || null,
            name: match.diseaseName,
          },
          type: sequelize.QueryTypes.UPDATE,
        }
      );

      if (rowsAffected > 0) {
        console.log(`  🔄 Updated "${match.diseaseName}" -> ICD: ${match.title} | ${match.foundationUri}`);
        updatedCount += rowsAffected;
      } else {
        // Try partial / fuzzy match by ICD code as fallback
        if (match.code) {
          const [codeRowsAffected] = await sequelize.query(
            `UPDATE diseases
             SET foundation_url = :url,
                 icd_title = :icdTitle
             WHERE code = :code
               AND (foundation_url IS NULL OR foundation_url = '')`,
            {
              replacements: {
                url: match.foundationUri,
                icdTitle: match.title || null,
                code: match.code,
              },
              type: sequelize.QueryTypes.UPDATE,
            }
          );

          if (codeRowsAffected > 0) {
            console.log(`  🔄 Updated by code "${match.code}" -> ICD: ${match.title} | ${match.foundationUri}`);
            updatedCount += codeRowsAffected;
          } else {
            console.log(`  ⚠️  No DB row found for "${match.diseaseName}" (code: ${match.code}) — skipped.`);
            skippedCount++;
          }
        } else {
          skippedCount++;
        }
      }
    }

    console.log('\n========================================');
    console.log(`✅ Migration complete.`);
    console.log(`   Updated : ${updatedCount} rows`);
    console.log(`   Skipped : ${skippedCount} entries (unmapped or already set)`);
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
