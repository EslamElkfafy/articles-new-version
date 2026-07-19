const xlsx = require('xlsx');
const fs = require('fs');

const files = [
    'Hypertension_recalculated.xlsx',
    'Alzheimer_Disease_recalculated.xlsx',
    'Diabetes_Mellitus_Type_2_recalculated.xlsx'
];

function processFile(filename) {
    if (!fs.existsSync(filename)) {
        console.error(`File not found: ${filename}`);
        return;
    }

    console.log(`Processing ${filename}...`);
    const workbook = xlsx.readFile(filename);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    const data = xlsx.utils.sheet_to_json(sheet, { defval: null });
    
    if (data.length === 0) {
        console.log(`No data found in ${filename}`);
        return;
    }

    const headers = Object.keys(data[0]);
    
    // Find the exact column name for 'rate combination'
    let rateCombinationCol = headers.find(h => {
        if (!h) return false;
        const clean = h.toLowerCase().trim();
        return clean === 'disease_rate_combination' || clean === 'rate combination' || clean === 'rate_combination' || clean === 'ratecombination';
    });
    
    if (!rateCombinationCol) {
        console.error(`ERROR: Could not find 'rate combination' column in ${filename}.`);
        console.error(`Available columns are:`, headers);
        console.log('--------------------------------------------------\n');
        return;
    }

    console.log(`Using column: "${rateCombinationCol}"`);

    const initialCount = data.length;
    
    // Filter out rows where rate combination is 0 or '0'
    const filteredData = data.filter(row => {
        const rateValue = row[rateCombinationCol];
        // We delete if it's strictly 0 or '0'
        const isZero = (rateValue === 0 || rateValue === '0' || rateValue === '0.0' || rateValue === 0.0);
        return !isZero;
    });

    const finalCount = filteredData.length;
    const removedCount = initialCount - finalCount;
    
    console.log(`Original rows: ${initialCount}`);
    console.log(`Removed rows (rate combination = 0): ${removedCount}`);
    console.log(`Remaining rows: ${finalCount}`);

    const newWorkbook = xlsx.utils.book_new();
    const newSheet = xlsx.utils.json_to_sheet(filteredData);
    xlsx.utils.book_append_sheet(newWorkbook, newSheet, sheetName);
    
    const newFilename = filename.replace('.xlsx', '_nonzero_rates.xlsx');
    xlsx.writeFile(newWorkbook, newFilename);
    console.log(`Saved file without zeros to: ${newFilename}`);
    console.log('--------------------------------------------------\n');
}

for (const file of files) {
    processFile(file);
}

console.log('All done!');
