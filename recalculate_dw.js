require("dotenv").config();
const { sequelize, ResearchResult } = require("./models/all");

async function recalculate() {
    try {
        await sequelize.authenticate();
        console.log("Connected to DB");

        // Get all records
        const allRecords = await ResearchResult.findAll();
        
        console.log(`Found ${allRecords.length} total records to process.`);

        // Group records by productId and diseaseId
        const groupMap = new Map();

        for (const record of allRecords) {
            const pid = record.productId;
            const did = record.diseaseId;

            // Skip records that don't have a mapped product
            if (!pid || pid === 0) continue;

            const groupKey = `${pid}_${did}`;
            if (!groupMap.has(groupKey)) {
                groupMap.set(groupKey, []);
            }
            groupMap.get(groupKey).push(record);
        }

        console.log(`Grouped into ${groupMap.size} valid product-disease pairs.`);

        let totalUpdated = 0;

        for (const [groupKey, records] of groupMap.entries()) {
            // Unpack IDs (optional, just for logging)
            const [productId, diseaseId] = groupKey.split('_');

            // Unique articles in this group
            const uniqueArticlesMap = new Map();
            
            for (const record of records) {
                // Use PMID or pubmed url or title as unique identifier for the article
                const articleKey = String(record.PMID || record.pubmed || record.title || record.id).trim();
                
                if (!uniqueArticlesMap.has(articleKey)) {
                    uniqueArticlesMap.set(articleKey, {
                        key: articleKey,
                        rate: (record.disease_rate_combination !== null && record.disease_rate_combination !== undefined) ? record.disease_rate_combination : 0,
                        records: []
                    });
                }
                uniqueArticlesMap.get(articleKey).records.push(record);
            }

            const uniqueArticles = Array.from(uniqueArticlesMap.values());
            
            // New articles_count
            const articles_count = uniqueArticles.length;
            
            // New category
            const category = articles_count <= 173 ? "ready" : "not_ready";

            // Recalculate DW
            const rates = uniqueArticles.map(a => a.rate === 0 ? 1 : a.rate);
            let calculated_dw = 0;
            if (rates.length > 0) {
                const sum = rates.reduce((a, b) => a + b, 0);
                const max = Math.max(...rates);
                calculated_dw = sum * max;
            }

            // Sort unique articles by rate descending to define new sequential article_number
            uniqueArticles.sort((a, b) => b.rate - a.rate);

            let updatedInGroup = 0;

            for (let j = 0; j < uniqueArticles.length; j++) {
                const articleGroup = uniqueArticles[j];
                const newArticleNumber = String(j + 1);

                for (const record of articleGroup.records) {
                    if (
                        record.articles_count !== articles_count ||
                        record.calculated_dw !== calculated_dw ||
                        String(record.article_number) !== newArticleNumber ||
                        record.category !== category
                    ) {
                        await record.update({
                            articles_count,
                            calculated_dw,
                            article_number: newArticleNumber,
                            category
                        });
                        updatedInGroup++;
                        totalUpdated++;
                    }
                }
            }

            if (updatedInGroup > 0) {
                console.log(`Updated product ${productId}, disease ${diseaseId} -> count: ${articles_count}, dw: ${calculated_dw}`);
            }
        }

        console.log(`\nRecalculation complete. Total records updated: ${totalUpdated}`);

    } catch (err) {
        console.error("Error during recalculation:", err);
    } finally {
        await sequelize.close();
    }
}

recalculate();
