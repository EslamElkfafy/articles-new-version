const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Check arguments
const args = process.argv.slice(2);
if (args.length === 0) {
    console.log("Usage: node recalculate_csv_dw.js <input_file.csv> [output_file.csv]");
    console.log("Example: node recalculate_csv_dw.js research_results_updated.csv");
    process.exit(1);
}

const inputFilePath = args[0];
const outputFilePath = args[1] || `recalculated_${path.basename(inputFilePath)}`;

// Simple CSV line parser that respects quotes
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' && line[i + 1] === '"') {
            current += '"';
            i++;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

// Escapes values for CSV output
function escapeCSV(val) {
    if (val === null || val === undefined) return '';
    val = String(val);
    if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
        return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
}

async function run() {
    if (!fs.existsSync(inputFilePath)) {
        console.error(`Error: File not found at ${inputFilePath}`);
        process.exit(1);
    }

    console.log(`Reading from: ${inputFilePath}`);
    const fileStream = fs.createReadStream(inputFilePath, 'utf8');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const rows = [];
    let headers = [];
    let isFirstLine = true;
    let buffer = '';
    let inQuotes = false;
    let lineCount = 0;

    for await (const line of rl) {
        let quoteCount = 0;
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '"') quoteCount++;
        }
        if (quoteCount % 2 !== 0) {
            inQuotes = !inQuotes;
        }

        buffer += line;

        if (inQuotes) {
            buffer += '\n';
            continue;
        }

        if (!buffer.trim() && !inQuotes) {
            buffer = '';
            continue;
        }

        const parsedLine = parseCSVLine(buffer);
        buffer = '';

        if (isFirstLine) {
            headers = parsedLine;
            isFirstLine = false;
        } else {
            rows.push(parsedLine);
        }

        lineCount++;
        if (lineCount % 5000 === 0) {
            console.log(`Parsed ${lineCount} lines...`);
        }
    }

    console.log(`Total rows to process: ${rows.length}`);

    // Map headers to indexes
    const idIdx = headers.indexOf('id');
    const productIdIdx = headers.indexOf('productId');
    const diseaseIdIdx = headers.indexOf('diseaseId');
    const pmidIdx = headers.indexOf('PMID');
    const pubmedIdx = headers.indexOf('pubmed');
    const titleIdx = headers.indexOf('title');
    const drComboIdx = headers.indexOf('disease_rate_combination');
    const dwIdx = headers.indexOf('calculated_dw');
    const articleNumIdx = headers.indexOf('article_number');
    const countIdx = headers.indexOf('articles_count');
    const catIdx = headers.indexOf('category');

    // Basic Validation
    if (productIdIdx === -1 || diseaseIdIdx === -1 || drComboIdx === -1 || dwIdx === -1) {
        console.error("Error: Missing required columns in CSV header.");
        console.error(`Required: productId (found: ${productIdIdx !== -1}), diseaseId (found: ${diseaseIdIdx !== -1}), disease_rate_combination (found: ${drComboIdx !== -1}), calculated_dw (found: ${dwIdx !== -1})`);
        process.exit(1);
    }

    // Group rows by productId and diseaseId
    const groupMap = new Map();
    for (const row of rows) {
        const pid = row[productIdIdx];
        const did = row[diseaseIdIdx];

        if (!pid || pid === '0' || pid === 'NULL' || pid === '') {
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
            const pmid = pmidIdx !== -1 ? row[pmidIdx] : '';
            const pubmed = pubmedIdx !== -1 ? row[pubmedIdx] : '';
            const title = titleIdx !== -1 ? row[titleIdx] : '';
            const rowId = idIdx !== -1 ? row[idIdx] : '';

            const articleKey = String(pmid || pubmed || title || rowId).trim();

            const rawRate = row[drComboIdx];
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
                const oldDW = r[dwIdx];
                const oldArtNum = articleNumIdx !== -1 ? r[articleNumIdx] : '';
                const oldCount = countIdx !== -1 ? r[countIdx] : '';
                const oldCat = catIdx !== -1 ? r[catIdx] : '';

                if (
                    oldDW !== String(calculated_dw) ||
                    (articleNumIdx !== -1 && oldArtNum !== newArticleNumber) ||
                    (countIdx !== -1 && oldCount !== String(articles_count)) ||
                    (catIdx !== -1 && oldCat !== category)
                ) {
                    r[dwIdx] = String(calculated_dw);
                    if (articleNumIdx !== -1) r[articleNumIdx] = newArticleNumber;
                    if (countIdx !== -1) r[countIdx] = String(articles_count);
                    if (catIdx !== -1) r[catIdx] = category;
                    updateCount++;
                }
            }
        }
    }

    console.log(`Recalculation finished. Total values updated: ${updateCount}`);

    // Save back to CSV
    console.log(`Writing results to: ${outputFilePath}`);
    const writeStream = fs.createWriteStream(outputFilePath, 'utf8');
    
    // Write headers
    writeStream.write(headers.map(escapeCSV).join(',') + '\n');
    
    // Write rows
    for (const row of rows) {
        writeStream.write(row.map(escapeCSV).join(',') + '\n');
    }
    
    writeStream.end();
    console.log(`Saved successfully to ${outputFilePath}`);
}

run().catch(console.error);
