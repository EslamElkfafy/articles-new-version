/**
 * migrate_research_results_icd.js
 *
 * Standalone migration: adds the `code`, `foundation_url`, and `icd_title` columns
 * to the `research_results` table if they don't already exist, and populates them
 * from icd11_disease_mappings.json.
 *
 * Run once:
 *   node migrate_research_results_icd.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const { sequelize, ResearchResult } = require('./models/all');
const MAPPINGS_FILE = path.join(__dirname, 'icd11_disease_mappings.json');

async function run() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database.');

    // 1. Add columns to research_results if they don't exist yet
    await sequelize.query(`
      ALTER TABLE research_results
      ADD COLUMN IF NOT EXISTS code TEXT,
      ADD COLUMN IF NOT EXISTS foundation_url TEXT,
      ADD COLUMN IF NOT EXISTS icd_title TEXT;
    `);
    console.log('✅ Columns `code`, `foundation_url` and `icd_title` are ready in `research_results` table.');

    // 2. Load the ICD-11 mappings file
    if (!fs.existsSync(MAPPINGS_FILE)) {
      console.error('❌ icd11_disease_mappings.json not found. Please run map_icd11_diseases.js first.');
      process.exit(1);
    }

    const mappings = JSON.parse(fs.readFileSync(MAPPINGS_FILE, 'utf8'));
    console.log(`📂 Loaded ${Object.keys(mappings).length} disease mappings from JSON file.`);

    // 3. Update each mapped disease row in research_results table
    let updatedCount = 0;
    let skippedCount = 0;
    const { Op } = require('sequelize');

    for (const [cleanName, match] of Object.entries(mappings)) {
      if (!match.mapped) {
        skippedCount++;
        continue;
      }

      const codeValue = match.code || null;
      const foundationUrl = match.foundationUri || null;
      const icdTitle = match.title || null;

      // Update all research_results where disease name matches cleanName or diseaseName using raw SQL
      const [rowsAffected] = await sequelize.query(
        `UPDATE research_results
         SET code = :code,
             foundation_url = :url,
             icd_title = :icdTitle
         WHERE (LOWER(disease) = LOWER(:cleanName) OR LOWER(disease) = LOWER(:diseaseName) OR LOWER(disease) = LOWER(:alternateName))
           AND (code IS NULL OR foundation_url IS NULL OR icd_title IS NULL)`,
        {
          replacements: {
            code: codeValue,
            url: foundationUrl,
            icdTitle: icdTitle,
            cleanName: cleanName,
            diseaseName: match.diseaseName,
            alternateName: cleanName.replace(/ s /g, "'s ")
          },
          type: sequelize.QueryTypes.UPDATE
        }
      );

      if (rowsAffected > 0) {
        console.log(`  🔄 Updated ${rowsAffected} rows for "${match.diseaseName}" -> ICD Title: "${icdTitle}", Code: "${codeValue}"`);
        updatedCount += rowsAffected;
      } else {
        skippedCount++;
      }
    }

    console.log('\n========================================');
    console.log(`✅ Backfill migration complete.`);
    console.log(`   Total rows updated: ${updatedCount}`);
    console.log(`   Diseases skipped/no matching rows: ${skippedCount}`);
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
