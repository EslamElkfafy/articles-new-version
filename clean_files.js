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
    
    // Find the exact column names
    let itemNameCol = headers.find(h => {
        const clean = h.toLowerCase().trim();
        return clean === 'item name' || clean === 'item_name' || clean === 'itemname' || clean === 'item';
    });
    
    let anotherItemCol = headers.find(h => {
        const clean = h.toLowerCase().trim();
        return clean === 'anthor item' || clean === 'another item' || clean === 'another_item' || clean === 'anotheritem' || clean === 'anther item';
    });

    if (!itemNameCol || !anotherItemCol) {
        console.error(`ERROR: Could not find both columns in ${filename}.`);
        console.error(`Found 'item name' column as: ${itemNameCol}`);
        console.error(`Found 'another item' column as: ${anotherItemCol}`);
        console.error(`Available columns are:`, headers);
        console.log('--------------------------------------------------\n');
        return;
    }

    console.log(`Using columns: "${itemNameCol}" and "${anotherItemCol}"`);

    const initialCount = data.length;
    
    const filteredData = data.filter(row => {
        const itemEmpty = (row[itemNameCol] === null || row[itemNameCol] === undefined || String(row[itemNameCol]).trim() === '');
        const anotherEmpty = (row[anotherItemCol] === null || row[anotherItemCol] === undefined || String(row[anotherItemCol]).trim() === '');
        
        return !(itemEmpty && anotherEmpty);
    });

    const finalCount = filteredData.length;
    const removedCount = initialCount - finalCount;
    
    console.log(`Original rows: ${initialCount}`);
    console.log(`Removed rows: ${removedCount}`);
    console.log(`Remaining rows: ${finalCount}`);

    const newWorkbook = xlsx.utils.book_new();
    const newSheet = xlsx.utils.json_to_sheet(filteredData);
    xlsx.utils.book_append_sheet(newWorkbook, newSheet, sheetName);
    
    const newFilename = filename.replace('.xlsx', '_cleaned.xlsx');
    xlsx.writeFile(newWorkbook, newFilename);
    console.log(`Saved cleaned file to: ${newFilename}`);
    console.log('--------------------------------------------------\n');
}

for (const file of files) {
    processFile(file);
}

console.log('All done!');
