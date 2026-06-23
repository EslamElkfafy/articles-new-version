const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Check arguments
const args = process.argv.slice(2);
if (args.length === 0) {
    console.log("Usage: node recalculate_xlsx_dw.js <input_file.xlsx/.xls> [output_file.xlsx]");
    console.log("Example: node recalculate_xlsx_dw.js Diabetes_Mellitus_Type_2_ready_articles.xls");
    process.exit(1);
}

const inputFilePath = args[0];
const outputFilePath = args[1] || `recalculated_${path.basename(inputFilePath)}`;

async function run() {
    if (!fs.existsSync(inputFilePath)) {
        console.error(`Error: File not found at ${inputFilePath}`);
        process.exit(1);
    }

    console.log(`Reading from Excel file: ${inputFilePath}`);
    const workbook = XLSX.readFile(inputFilePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Get original headers order
    const headers = [];
    const range = XLSX.utils.decode_range(sheet['!ref']);
    for (let C = range.s.c; C <= range.e.c; ++C) {
        const addr = XLSX.utils.encode_cell({ r: range.s.r, c: C });
        const cell = sheet[addr];
        if (cell && cell.v !== undefined) {
            headers.push(String(cell.v).trim());
        }
    }

    // Convert sheet to JSON objects with null defaults for missing cells
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    console.log(`Total rows loaded: ${rows.length}`);

    // Validate headers
    const hasProductId = headers.includes('productId');
    const hasDiseaseId = headers.includes('diseaseId');
    const hasDrCombo = headers.includes('disease_rate_combination');
    const hasDw = headers.includes('calculated_dw');

    if (!hasProductId || !hasDiseaseId || !hasDrCombo || !hasDw) {
        console.error("Error: Missing required columns in Excel sheet header.");
        console.error(`Required columns check:
- productId: ${hasProductId ? 'FOUND' : 'MISSING'}
- diseaseId: ${hasDiseaseId ? 'FOUND' : 'MISSING'}
- disease_rate_combination: ${hasDrCombo ? 'FOUND' : 'MISSING'}
- calculated_dw: ${hasDw ? 'FOUND' : 'MISSING'}`);
        process.exit(1);
    }

    // Group rows by productId and diseaseId
    const groupMap = new Map();
    for (const row of rows) {
        const pid = row.productId;
        const did = row.diseaseId;

        if (!pid || pid === 0 || pid === '0' || pid === 'NULL' || pid === '') {
            continue;
        }

        const groupKey = `${pid}_${did}`;
        if (!groupMap.has(groupKey)) {
            groupMap.set(groupKey, []);
        }
        groupMap.get(groupKey).push(row);
    }

    console.log(`Grouped into ${groupMap.size} product-disease pairs.`);

    let updateCount = 0;

    for (const [groupKey, groupRows] of groupMap.entries()) {
        const uniqueArticlesMap = new Map();

        for (const row of groupRows) {
            const pmid = row.PMID;
            const pubmed = row.pubmed;
            const title = row.title;
            const rowId = row.id;

            const articleKey = String(pmid || pubmed || title || rowId).trim();

            const rawRate = row.disease_rate_combination;
            let rateVal = parseFloat(rawRate);
            if (isNaN(rateVal)) {
                rateVal = 0;
            }

            if (!uniqueArticlesMap.has(articleKey)) {
                uniqueArticlesMap.set(articleKey, {
                    key: articleKey,
                    rate: rateVal,
                    rows: []
                });
            }
            uniqueArticlesMap.get(articleKey).rows.push(row);
        }

        const uniqueArticles = Array.from(uniqueArticlesMap.values());
        const articles_count = uniqueArticles.length;
        const category = articles_count <= 173 ? "ready" : "not_ready";

        // Calculate DW using combination rate
        const rates = uniqueArticles.map(a => a.rate || 0);
        let calculated_dw = 0;
        if (rates.length > 0) {
            const sum = rates.reduce((a, b) => a + b, 0);
            const max = Math.max(...rates);
            calculated_dw = sum * max;
        }

        // Sort unique articles descending by rate to determine new article_number
        uniqueArticles.sort((a, b) => b.rate - a.rate);

        for (let j = 0; j < uniqueArticles.length; j++) {
            const articleGroup = uniqueArticles[j];
            const newArticleNumber = String(j + 1);

            for (const r of articleGroup.rows) {
                const oldDW = r.calculated_dw;
                const oldArtNum = r.article_number;
                const oldCount = r.articles_count;
                const oldCat = r.category;

                r.calculated_dw = calculated_dw;
                if ('article_number' in r) r.article_number = newArticleNumber;
                if ('articles_count' in r) r.articles_count = articles_count;
                if ('category' in r) r.category = category;

                if (
                    oldDW !== calculated_dw ||
                    oldArtNum !== newArticleNumber ||
                    oldCount !== articles_count ||
                    oldCat !== category
                ) {
                    updateCount++;
                }
            }
        }
    }

    console.log(`Recalculation finished. Total values updated: ${updateCount}`);

    // Create a new sheet and workbook
    console.log(`Writing results to Excel: ${outputFilePath}`);
    const newSheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    const newWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWorkbook, newSheet, sheetName);

    XLSX.writeFile(newWorkbook, outputFilePath);
    console.log(`Saved successfully to ${outputFilePath}`);
}

run().catch(console.error);
