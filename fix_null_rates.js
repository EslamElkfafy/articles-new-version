require("dotenv").config();
const { ResearchResult, sequelize } = require("./models/all");

const pubTypeRates = {
    "Systematic Review": 5,
    "Meta-Analysis": 5,
    "Randomized Controlled Trial": 4,
    "Controlled Clinical Trial": 4,
    "Clinical Trial": 4,
    "Clinical Trial Protocol": 3,
    "Multicenter Study": 3,
    "Observational Study": 3,
    "Comparative Study": 3,
    "Evaluation Study": 3,
    "Validation Studies": 3,
    "Case Reports": 2,
    "Review": 2,
    "Technical Report": 2,
    "Editorial": 1,
    "Letter": 1,
    "Comment": 1,
    "Consensus Development Conference": 1,
    "Practice Guideline": 1,
    "Guideline": 1,
    "Retracted Publication": 1,
    "Corrected and Republished Article": 1,
};

async function fixRates() {
    try {
        await sequelize.authenticate();
        console.log("✅ Connected to Database.");

        // Get all records where disease_rates is null or 0
        const records = await ResearchResult.findAll();
        console.log(`🔍 Inspecting all ${records.length} records...`);

        let fixedCount = 0;

        for (const record of records) {
            const hasNullRate = record.disease_rates === null || record.disease_rates === undefined || record.disease_rates === 0;
            
            if (hasNullRate) {
                // Determine rate from pubtypes or ai_pubtypes
                const typesString = `${record.pubtypes || ''}, ${record.ai_pubtypes || ''}`.toLowerCase();
                let highestRate = 0;

                for (const [typeName, rateValue] of Object.entries(pubTypeRates)) {
                    if (typesString.includes(typeName.toLowerCase())) {
                        if (rateValue > highestRate) {
                            highestRate = rateValue;
                        }
                    }
                }

                // Fallback to rate column if defined
                if (highestRate === 0 && record.rate) {
                    highestRate = parseInt(record.rate, 10) || 0;
                }

                if (highestRate > 0) {
                    record.disease_rates = highestRate;
                    
                    // Re-calculate disease_rate_combination
                    if (record.diseases_rate_all_null === 0) {
                        record.disease_rate_combination = 0;
                    } else {
                        record.disease_rate_combination = highestRate;
                    }

                    await record.save();
                    fixedCount++;
                }
            } else {
                // If it already has a valid disease_rate, make sure combination is synced
                const expectedCombo = record.diseases_rate_all_null === 0 ? 0 : record.disease_rates;
                if (record.disease_rate_combination !== expectedCombo) {
                    record.disease_rate_combination = expectedCombo;
                    await record.save();
                    fixedCount++;
                }
            }
        }

        console.log(`✨ Successfully updated/fixed ${fixedCount} records in the database!`);
        await sequelize.close();
    } catch (e) {
        console.error("❌ Error running migration:", e);
    }
}

fixRates();
