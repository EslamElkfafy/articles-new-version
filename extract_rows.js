const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Target Files
const csvFile = path.join(__dirname, 'Diabetes_Mellitus_Type_2_all_articles.csv');
const recalXlsxFile = path.join(__dirname, 'Diabetes_Mellitus_Type_2_recalculated.xlsx');
const mappingXlsxFile = path.join(__dirname, 'new_script_mapping11.xlsx');

// Output Files
const outCsvFile = path.join(__dirname, 'extracted_pomegranate_diabetes_all_articles.csv');
const outRecalXlsxFile = path.join(__dirname, 'extracted_pomegranate_diabetes_recalculated.xlsx');
const outRecalCsvFile = path.join(__dirname, 'extracted_pomegranate_diabetes_recalculated.csv');
const outMappingXlsxFile = path.join(__dirname, 'extracted_pomegranate_diabetes_mapping11.xlsx');
const outMappingCsvFile = path.join(__dirname, 'extracted_pomegranate_diabetes_mapping11.csv');

// Keywords (case-insensitive)
const ITEM_KEYWORD = 'pomegranate';
const DISEASE_KEYWORD = 'diabetes';

console.log('🚀 Starting Pomegranate & Diabetes Rows Extraction...');
console.log(`Keywords: Item contains "${ITEM_KEYWORD}", Disease contains "${DISEASE_KEYWORD}"\n`);

// Priority Lists for identifying columns (exact match on lowercase, avoiding fuzzy matching like 'includes' which hits 'productId')
const ITEM_KEYS_PRIORITY = ['root_name', 'item_name', 'another_item', 'name', 'product', 'item', 'root'];
const DISEASE_KEYS_PRIORITY = ['disease', 'disease_name', 'icd_title', 'diseaseid', 'diseaseId'];

function findPriorityKey(keys, priorityList) {
    for (const priority of priorityList) {
        const found = keys.find(k => k.toLowerCase() === priority.toLowerCase());
        if (found) return found;
    }
    return null;
}

// Helper to check match on row values
function rowMatches(row, itemKey, diseaseKey) {
    let itemVal = '';
    let diseaseVal = '';

    if (itemKey && row[itemKey] !== undefined && row[itemKey] !== null) {
        itemVal = String(row[itemKey]).trim();
    }
    if (diseaseKey && row[diseaseKey] !== undefined && row[diseaseKey] !== null) {
        diseaseVal = String(row[diseaseKey]).trim();
    }

    // Must match pomegranate in the product/item name
    const isPomegranate = itemVal.toLowerCase().includes(ITEM_KEYWORD);
    if (!isPomegranate) {
        return false;
    }

    // Check disease if column exists
    let isDiabetes = true;
    if (diseaseVal) {
        isDiabetes = diseaseVal.toLowerCase().includes(DISEASE_KEYWORD) || diseaseVal.toLowerCase().includes('mellitus');
    }

    return isPomegranate && isDiabetes;
}

// 1. Process CSV File: Diabetes_Mellitus_Type_2_all_articles.csv
function processCSV() {
    console.log(`📂 Reading CSV: ${csvFile}...`);
    if (!fs.existsSync(csvFile)) {
        console.error(`❌ CSV File not found at: ${csvFile}`);
        return;
    }

    try {
        const workbook = XLSX.readFile(csvFile);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        console.log(`   Loaded ${rows.length} rows from CSV.`);

        if (rows.length === 0) {
            console.log('   CSV sheet is empty.');
            return;
        }

        // Find headers/keys
        const keys = Object.keys(rows[0]);
        const itemKey = findPriorityKey(keys, ITEM_KEYS_PRIORITY);
        const diseaseKey = findPriorityKey(keys, DISEASE_KEYS_PRIORITY);

        console.log(`   Matched keys - Item Column: "${itemKey}", Disease Column: "${diseaseKey}"`);

        const filtered = rows.filter(row => rowMatches(row, itemKey, diseaseKey));
        console.log(`   Found ${filtered.length} matching rows.`);

        // Save CSV output
        const newSheet = XLSX.utils.json_to_sheet(filtered);
        const csvContent = XLSX.utils.sheet_to_csv(newSheet);
        fs.writeFileSync(outCsvFile, csvContent, 'utf8');
        console.log(`   💾 Saved filtered CSV to: ${outCsvFile}`);

    } catch (e) {
        console.error(`❌ Error processing CSV:`, e);
    }
}

// 2. Process XLSX File: Diabetes_Mellitus_Type_2_recalculated.xlsx
function processRecalXlsx() {
    console.log(`\n📂 Reading Recalculated Excel: ${recalXlsxFile}...`);
    if (!fs.existsSync(recalXlsxFile)) {
        console.error(`❌ Excel File not found at: ${recalXlsxFile}`);
        return;
    }

    try {
        const workbook = XLSX.readFile(recalXlsxFile);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        console.log(`   Loaded ${rows.length} rows.`);

        if (rows.length === 0) {
            console.log('   Excel sheet is empty.');
            return;
        }

        const keys = Object.keys(rows[0]);
        const itemKey = findPriorityKey(keys, ITEM_KEYS_PRIORITY);
        const diseaseKey = findPriorityKey(keys, DISEASE_KEYS_PRIORITY);

        console.log(`   Matched keys - Item Column: "${itemKey}", Disease Column: "${diseaseKey}"`);

        const filtered = rows.filter(row => rowMatches(row, itemKey, diseaseKey));
        console.log(`   Found ${filtered.length} matching rows.`);

        // Save outputs
        const newSheet = XLSX.utils.json_to_sheet(filtered);
        
        // Save Excel
        const newWorkbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWorkbook, newSheet, "Extracted");
        XLSX.writeFile(newWorkbook, outRecalXlsxFile);
        console.log(`   💾 Saved Excel results to: ${outRecalXlsxFile}`);

        // Save CSV version
        const csvContent = XLSX.utils.sheet_to_csv(newSheet);
        fs.writeFileSync(outRecalCsvFile, csvContent, 'utf8');
        console.log(`   💾 Saved CSV version to: ${outRecalCsvFile}`);

    } catch (e) {
        console.error(`❌ Error processing Recalculated Excel:`, e);
    }
}

// 3. Process XLSX File: new_script_mapping11.xlsx
function processMappingXlsx() {
    console.log(`\n📂 Reading Mapping Excel: ${mappingXlsxFile}...`);
    if (!fs.existsSync(mappingXlsxFile)) {
        console.error(`❌ Excel File not found at: ${mappingXlsxFile}`);
        return;
    }

    try {
        const workbook = XLSX.readFile(mappingXlsxFile);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        console.log(`   Loaded ${rows.length} rows.`);

        if (rows.length === 0) {
            console.log('   Excel sheet is empty.');
            return;
        }

        const keys = Object.keys(rows[0]);
        const itemKey = findPriorityKey(keys, ITEM_KEYS_PRIORITY);
        const diseaseKey = findPriorityKey(keys, DISEASE_KEYS_PRIORITY);

        console.log(`   Matched keys - Item Column: "${itemKey}", Disease Column: "${diseaseKey}"`);

        const filtered = rows.filter(row => rowMatches(row, itemKey, diseaseKey));
        console.log(`   Found ${filtered.length} matching rows.`);

        // Save outputs
        const newSheet = XLSX.utils.json_to_sheet(filtered);
        
        // Save Excel
        const newWorkbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(newWorkbook, newSheet, "Extracted");
        XLSX.writeFile(newWorkbook, outMappingXlsxFile);
        console.log(`   💾 Saved Excel results to: ${outMappingXlsxFile}`);

        // Save CSV version
        const csvContent = XLSX.utils.sheet_to_csv(newSheet);
        fs.writeFileSync(outMappingCsvFile, csvContent, 'utf8');
        console.log(`   💾 Saved CSV version to: ${outMappingCsvFile}`);

    } catch (e) {
        console.error(`❌ Error processing Mapping Excel:`, e);
    }
}

processCSV();
processRecalXlsx();
processMappingXlsx();

console.log('\n✨ Extraction Finished! Please review the output files in your workspace.');
