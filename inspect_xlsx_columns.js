const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const file1 = path.join(__dirname, 'Diabetes_Mellitus_Type_2_recalculated.xlsx');
const file2 = path.join(__dirname, 'new_script_mapping11.xlsx');
const logFile = path.join(__dirname, 'xlsx_inspection_log.txt');

let logContent = '';
function log(msg) {
    console.log(msg);
    logContent += msg + '\n';
}

function inspectFile(filePath, name) {
    log(`\n=== Inspecting ${name} (${path.basename(filePath)}) ===`);
    if (!fs.existsSync(filePath)) {
        log(`Error: File not found!`);
        return;
    }
    try {
        const workbook = XLSX.readFile(filePath);
        log(`Sheets: ${workbook.SheetNames.join(', ')}`);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        log(`Total Rows: ${rows.length}`);
        if (rows.length > 0) {
            const keys = Object.keys(rows[0]);
            log(`Columns (keys): ${keys.join(', ')}`);
            log(`First 5 rows sample:`);
            for (let i = 0; i < Math.min(5, rows.length); i++) {
                log(`Row ${i}: ${JSON.stringify(rows[i])}`);
            }

            // Let's search for "pomegranate" in the keys and values of all rows and print if found
            log(`Searching for any row containing "pomegranate" (case-insensitive)...`);
            let foundCount = 0;
            rows.forEach((row, idx) => {
                const rowStr = Object.values(row).join(' ').toLowerCase();
                if (rowStr.includes('pomegranate')) {
                    foundCount++;
                    if (foundCount <= 10) {
                        log(`Match ${foundCount} (Row ${idx + 2}): ${JSON.stringify(row)}`);
                    }
                }
            });
            log(`Total rows containing "pomegranate" anywhere: ${foundCount}`);
        }
    } catch (e) {
        log(`Error: ${e.message}`);
    }
}

inspectFile(file1, 'Diabetes_Mellitus_Type_2_recalculated');
inspectFile(file2, 'new_script_mapping11');

fs.writeFileSync(logFile, logContent, 'utf8');
log(`\nSaved inspection log to ${logFile}`);
