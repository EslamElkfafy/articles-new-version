const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { Op } = require('sequelize');

// Import from the main script and DB models
const { getURL } = require('./getURL');
const { sequelize, ResearchResult } = require('./models/all');

// Target Files (Input)
const inputFiles = [
    {
        name: 'All Articles CSV',
        path: path.join(__dirname, 'extracted_pomegranate_diabetes_all_articles.csv'),
        outXlsx: path.join(__dirname, 'processed_extracted_pomegranate_diabetes_all_articles.xlsx'),
        outCsv: path.join(__dirname, 'processed_extracted_pomegranate_diabetes_all_articles.csv')
    },
    {
        name: 'Recalculated XLSX',
        path: path.join(__dirname, 'extracted_pomegranate_diabetes_recalculated.xlsx'),
        outXlsx: path.join(__dirname, 'processed_extracted_pomegranate_diabetes_recalculated.xlsx'),
        outCsv: path.join(__dirname, 'processed_extracted_pomegranate_diabetes_recalculated.csv')
    },
    {
        name: 'Mapping XLSX',
        path: path.join(__dirname, 'extracted_pomegranate_diabetes_mapping11.xlsx'),
        outXlsx: path.join(__dirname, 'processed_extracted_pomegranate_diabetes_mapping11.xlsx'),
        outCsv: path.join(__dirname, 'processed_extracted_pomegranate_diabetes_mapping11.csv')
    }
];

// Helper to lookup DB records for an article
async function findDbRecordsForArticle(article) {
    const where = {};

    // 1. Try PMID
    if (article.PMID) {
        const res = await ResearchResult.findAll({ 
            where: { ...where, PMID: String(article.PMID).trim() },
            order: [['createdAt', 'DESC']]
        });
        if (res && res.length > 0) return res.map(r => r.toJSON());
    }
    // 2. Try DOI/doi
    if (article.doi || article.DOI) {
        const targetDoi = String(article.doi || article.DOI).trim();
        const res = await ResearchResult.findAll({
            where: {
                ...where,
                [Op.or]: [
                    { doi: targetDoi },
                    { DOI: targetDoi }
                ]
            },
            order: [['createdAt', 'DESC']]
        });
        if (res && res.length > 0) return res.map(r => r.toJSON());
    }
    // 3. Try Pubmed URL
    if (article.pubmed) {
        const res = await ResearchResult.findAll({ 
            where: { ...where, pubmed: String(article.pubmed).trim() },
            order: [['createdAt', 'DESC']]
        });
        if (res && res.length > 0) return res.map(r => r.toJSON());
    }
    // 4. Try Title (exact match)
    if (article.title) {
        const res = await ResearchResult.findAll({ 
            where: { ...where, title: String(article.title).trim() },
            order: [['createdAt', 'DESC']]
        });
        if (res && res.length > 0) return res.map(r => r.toJSON());
    }
    return [];
}

// Post-processing logic copied from getURL.js main()
async function runPostProcessing(touchedDiseaseIds) {
    console.log(`\n🔄 Starting Post-Processing (Updates, Recalculations, Sorting) for touched diseases...`);

    for (const diseaseId of touchedDiseaseIds) {
        console.log(`\n  >> Post-Processing for disease ID: ${diseaseId}`);

        // Step 1: Remove duplicates
        console.log(`   🔄 Removing duplicate articles...`);
        const allRecordsToCheck = await ResearchResult.findAll({
            where: { diseaseId: diseaseId },
            order: [
                ['productId', 'ASC'],
                ['createdAt', 'DESC'] // Keep the newest/last inserted
            ]
        });

        const articleProductMap = new Map();
        for (const record of allRecordsToCheck) {
            let articleKey = '';
            if (record.PMID) articleKey = `PMID_${record.PMID}`;
            else if (record.doi || record.DOI) articleKey = `DOI_${record.doi || record.DOI}`;
            else if (record.pubmed) articleKey = `PUBMED_${record.pubmed}`;
            else if (record.title) articleKey = `TITLE_${record.title.substring(0, 50).toLowerCase()}`;
            else articleKey = `ID_${record.id}`;

            const key = `${record.productId}_${articleKey}`;
            if (!articleProductMap.has(key)) {
                articleProductMap.set(key, []);
            }
            articleProductMap.get(key).push(record);
        }

        const duplicateIdsToRemove = [];
        for (const [key, records] of articleProductMap.entries()) {
            if (records.length > 1) {
                for (let i = 1; i < records.length; i++) duplicateIdsToRemove.push(records[i].id);
            }
        }

        if (duplicateIdsToRemove.length > 0) {
            await ResearchResult.destroy({ where: { id: duplicateIdsToRemove } });
            console.log(`   ✅ Removed ${duplicateIdsToRemove.length} duplicate records to prevent overlapping.`);
        } else {
            console.log(`   ✅ No duplicates found.`);
        }

        // Step 2: Recalculate DW and counts
        console.log(`   🔄 Recalculating DW and counts for all products...`);
        const allRecordsInDisease = await ResearchResult.findAll({
            where: { diseaseId: diseaseId },
            order: [
                ['productId', 'ASC'],
                ['article_number', 'ASC']
            ]
        });

        const groupMap = new Map();
        for (const record of allRecordsInDisease) {
            const pid = record.productId;
            if (!pid || pid == 0) continue;
            if (!groupMap.has(pid)) groupMap.set(pid, []);
            groupMap.get(pid).push(record);
        }

        let recalcUpdates = 0;
        const recalcPromises = [];

        for (const [pid, records] of groupMap.entries()) {
            const uniqueArticlesMap = new Map();
            for (const record of records) {
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
            const articles_count = uniqueArticles.length;
            const category = articles_count <= 173 ? "ready" : "not_ready";

            const rates = uniqueArticles.map(a => a.rate || 0);
            let calculated_dw = 0;
            if (rates.length > 0) {
                const sum = rates.reduce((a, b) => a + b, 0);
                const max = Math.max(...rates);
                calculated_dw = sum * max;
            }

            uniqueArticles.sort((a, b) => b.rate - a.rate);

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
                        recalcPromises.push(record.update({
                            articles_count,
                            calculated_dw,
                            article_number: newArticleNumber,
                            category
                        }));
                        recalcUpdates++;
                    }
                }
            }
        }

        await Promise.all(recalcPromises);
        console.log(`   ✅ Recalculated DW and counts updated ${recalcUpdates} records.`);

        // Step 3: Physically sort the rows
        console.log(`   🔄 Physically sorting the rows in the database...`);
        const finalSortedRecords = await ResearchResult.findAll({
            where: { diseaseId: diseaseId },
            order: [
                ['productId', 'ASC'],
                [sequelize.literal('NULLIF("article_number", \'\')::INTEGER'), 'ASC']
            ],
            raw: true
        });

        if (finalSortedRecords.length > 0) {
            await ResearchResult.destroy({ where: { diseaseId: diseaseId } });
            const recordsToInsert = finalSortedRecords.map(r => {
                delete r.id;
                return r;
            });
            await ResearchResult.bulkCreate(recordsToInsert);
            console.log(`   ✅ Disease ${diseaseId} database rows physically sorted.`);
        }
    }
}

// Process a single file
async function processFile(fileInfo) {
    console.log(`\n======================================================`);
    console.log(`📖 Processing file: ${fileInfo.name} (${path.basename(fileInfo.path)})`);
    console.log(`======================================================`);

    if (!fs.existsSync(fileInfo.path)) {
        console.warn(`⚠️ Warning: Input file not found: ${fileInfo.path}. Skipping.`);
        return;
    }

    // 1. Read sheet
    const workbook = XLSX.readFile(fileInfo.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Decode headers
    const headers = [];
    const range = XLSX.utils.decode_range(sheet['!ref']);
    for (let C = range.s.c; C <= range.e.c; ++C) {
        const addr = XLSX.utils.encode_cell({ r: range.s.r, c: C });
        const cell = sheet[addr];
        if (cell && cell.v !== undefined) {
            headers.push(String(cell.v).trim());
        }
    }

    const allRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    console.log(`📊 Loaded ${allRows.length} rows to process.`);

    if (allRows.length === 0) {
        console.log(`   File is empty. Skipping.`);
        return;
    }

    // 2. Pre-process IDs (same as in getURL.js main)
    const processedRows = allRows.map(article => {
        if (article.pubmed && !article.PMID) {
            const match = String(article.pubmed).match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);
            article.PMID = match ? match[1] : null;
        }
        if (article.pmc && !article.PMCID) {
            const match = String(article.pmc).match(/pmc\/articles\/(PMC\d+)/);
            article.PMCID = match ? match[1] : null;
        }
        if (article.doi && !article.DOI) {
            const match = String(article.doi).match(/doi\.org\/(.+)/);
            article.DOI = match ? match[1] : null;
        }
        return article;
    });

    // 3. Group by disease (preserves diseaseId: 2, 28, etc. properly)
    const diseaseGroups = new Map();
    for (const row of processedRows) {
        const did = parseInt(row.diseaseId, 10) || 28; // fallback to 28
        const dname = row.disease || "Diabetes Mellitus, Type 2";
        const key = `${did}__${dname}`;
        if (!diseaseGroups.has(key)) {
            diseaseGroups.set(key, []);
        }
        diseaseGroups.get(key).push(row);
    }

    const allTouchedDiseaseIds = new Set();

    // 4. Batch-process each disease group
    for (const [key, rowsInGroup] of diseaseGroups.entries()) {
        const [diseaseIdStr, diseaseName] = key.split('__');
        const diseaseId = parseInt(diseaseIdStr, 10);

        console.log(`\n🦠 Processing Disease Group: "${diseaseName}" (ID: ${diseaseId}) with ${rowsInGroup.length} articles.`);

        let currentIndex = 0;
        const batchSize = 100;

        while (currentIndex < rowsInGroup.length) {
            const nextIndex = Math.min(currentIndex + batchSize, rowsInGroup.length);
            const currentBatch = rowsInGroup.slice(currentIndex, nextIndex);

            console.log(`   Processing batch: rows ${currentIndex + 1} to ${nextIndex}...`);

            const pseudoGroup = {
                id: 0,
                root_name: "Dynamic",
                disease_id: diseaseId,
                disease_name: diseaseName,
                articles_count: currentBatch.length,
                category: "ready",
                calculated_dw: 0,
                articles: currentBatch
            };

            const touchedDiseaseIds = await getURL([pseudoGroup]);
            if (touchedDiseaseIds && Array.isArray(touchedDiseaseIds)) {
                touchedDiseaseIds.forEach(id => allTouchedDiseaseIds.add(id));
            }

            currentIndex = nextIndex;
        }
    }

    // 5. Run Database post-processing for all touched disease IDs in this file
    if (allTouchedDiseaseIds.size > 0) {
        await runPostProcessing(Array.from(allTouchedDiseaseIds));
    }

    // 5.5. Run ICD-11 diseases mapper to align code, foundation_url, and icd_title fields
    console.log(`\n🩺 Running ICD-11 diseases mapper to align code and foundation_url fields...`);
    try {
        delete require.cache[require.resolve('./map_icd11_diseases')];
        const runIcdMapping = require('./map_icd11_diseases');
        await runIcdMapping();
        console.log(`✅ ICD-11 mapping complete for this file.`);
    } catch (icdErr) {
        console.error(`⚠️ ICD-11 mapping encountered an error:`, icdErr.message);
    }

    // 6. Update spreadsheet rows from database records and output new files
    console.log(`\n💾 Backfilling updated values from Database into spreadsheet...`);
    const updatedRows = [];
    
    for (const originalRow of processedRows) {
        const dbRecords = await findDbRecordsForArticle(originalRow);
        
        if (dbRecords && dbRecords.length > 0) {
            for (const dbRecord of dbRecords) {
                // Merge DB fields in-place into a copy of originalRow
                const mergedRow = { ...originalRow };
                
                // Map db record fields back to the spreadsheet row
                const fieldsToMerge = [
                    'productId', 'root_name', 'scientific_name', 'diseaseId', 'disease', 
                    'code', 'foundation_url', 'icd_title', 'articles_count', 'category', 
                    'calculated_dw', 'article_number', 'title', 'pubmed', 'PMID', 
                    'doi', 'DOI', 'pmc', 'PMCID', 'pubtypes', 'ai_pubtypes', 'rate', 
                    'disease_rates', 'diseases_rate_all_null', 'disease_rate_combination', 
                    'name', 'processing_status'
                ];

                for (const f of fieldsToMerge) {
                    if (dbRecord[f] !== undefined && dbRecord[f] !== null) {
                        mergedRow[f] = dbRecord[f];
                    }
                }

                // Convert dynamic root causes and labs back to stringified formats
                if (dbRecord.dynamic_root_causes) {
                    mergedRow.dynamic_root_causes = JSON.stringify(dbRecord.dynamic_root_causes);
                }
                if (dbRecord.labs) {
                    mergedRow.labs = JSON.stringify(dbRecord.labs);
                }

                updatedRows.push(mergedRow);
            }
        } else {
            // Keep original if not found in database
            updatedRows.push(originalRow);
        }
    }

    // Write output files
    console.log(`   Writing processed sheet to Excel: ${fileInfo.outXlsx}`);
    const outWorkbook = XLSX.utils.book_new();
    const outSheet = XLSX.utils.json_to_sheet(updatedRows, { header: headers });
    XLSX.utils.book_append_sheet(outWorkbook, outSheet, sheetName);
    XLSX.writeFile(outWorkbook, fileInfo.outXlsx);

    console.log(`   Writing processed sheet to CSV: ${fileInfo.outCsv}`);
    const csvContent = XLSX.utils.sheet_to_csv(outSheet);
    fs.writeFileSync(fileInfo.outCsv, csvContent, 'utf8');

    console.log(`\\n✅ Completed file: ${fileInfo.name}!`);
}

// Main Runner
(async () => {
    try {
        console.log("🚀 Starting processing wrapper for Pomegranate extracted files...");
        
        // Authenticate DB
        await sequelize.authenticate();
        console.log("✅ Database Connected.");
        try {
            await sequelize.sync({ alter: true });
            console.log("📦 Database Tables Synced.");
        } catch (syncErr) {
            console.warn("⚠️ Database sync failed/skipped: " + syncErr.message);
        }

        // Process all files
        for (const fileInfo of inputFiles) {
            await processFile(fileInfo);
        }

        console.log("\n🎉 All 3 extracted files have been processed by getURL.js and saved to their respective output files successfully!");

    } catch (e) {
        console.error("❌ Critical error in runner script:", e);
    } finally {
        await sequelize.close();
        console.log("🔌 Database Connection Closed.");
    }
})();
