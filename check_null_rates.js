const { ResearchResult, sequelize } = require("./models/all");

async function main() {
    try {
        await sequelize.authenticate();
        console.log("✅ Database connected.");

        const totalCount = await ResearchResult.count();
        const nullRatesCount = await ResearchResult.count({
            where: {
                disease_rates: null
            }
        });

        const zeroRatesCount = await ResearchResult.count({
            where: {
                disease_rates: 0
            }
        });

        console.log(`📊 DB Statistics:`);
        console.log(`   Total records: ${totalCount}`);
        console.log(`   Records with null disease_rates: ${nullRatesCount}`);
        console.log(`   Records with 0 disease_rates: ${zeroRatesCount}`);
        
        await sequelize.close();
    } catch (e) {
        console.error("❌ Error:", e);
    }
}

main();
