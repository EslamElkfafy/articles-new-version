const xlsx = require('xlsx');
const fs = require('fs');

const csvFile = 'Diabetes_Mellitus_Type_2_all_articles.csv';
const xlsx1File = 'Diabetes_Mellitus_Type_2_recalculated.xlsx';
const xlsx2File = 'new_script_mapping11.xlsx';

function inspectCSVHeaders() {
    console.log('--- Inspecting CSV ---');
    try {
        const stream = fs.readFileSync(csvFile, 'utf8');
        // Get the first few lines
        const lines = stream.split('\n').slice(0, 5);
        lines.forEach((line, index) => {
            console.log(`Line ${index + 1}: ${line}`);
        });
    } catch (e) {
        console.error('Error reading CSV:', e);
    }
}

function inspectXLSXHeaders(filePath) {
    console.log(`--- Inspecting XLSX: ${filePath} ---`);
    try {
        const workbook = xlsx.readFile(filePath, { sheetRows: 5 });
        const sheetName = workbook.SheetNames[0];
        console.log('Sheet Names:', workbook.SheetNames);
        const sheet = workbook.Sheets[sheetName];
        const data = xlsx.utils.sheet_to_json(sheet);
        console.log('Row count loaded (max 5):', data.length);
        if (data.length > 0) {
            console.log('Keys:', Object.keys(data[0]));
            console.log('First row sample:', data[0]);
        }
    } catch (e) {
        console.error('Error reading XLSX:', e);
    }
}

inspectCSVHeaders();
inspectXLSXHeaders(xlsx1File);
inspectXLSXHeaders(xlsx2File);
