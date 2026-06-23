const XLSX = require('xlsx');
const path = require('path');

try {
    const excelPath = path.join(__dirname, 'recalculated_new_script_mapping11.xlsx');
    console.log("Loading workbook from:", excelPath);
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Check headers
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const headers = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
        const addr = XLSX.utils.encode_cell({ r: range.s.r, c: C });
        const cell = sheet[addr];
        if (cell && cell.v !== undefined) {
            headers.push(String(cell.v).trim());
        }
    }
    
    console.log("\nSpreadsheet Headers:");
    console.log(headers.slice(0, 10).join(', ') + " ...");
    
    const rootNameIdx = headers.indexOf('root_name');
    const rootOriginNameIdx = headers.indexOf('root_origin_name');
    
    console.log(`\n'root_name' index: ${rootNameIdx}`);
    console.log(`'root_origin_name' index: ${rootOriginNameIdx}`);
    
    if (rootOriginNameIdx === rootNameIdx + 1) {
        console.log("✅ SUCCESS: 'root_origin_name' is placed directly after 'root_name'!");
    } else {
        console.log("❌ WARNING: 'root_origin_name' is NOT directly after 'root_name'.");
    }

    const rows = XLSX.utils.sheet_to_json(sheet);
    console.log(`\nTotal rows: ${rows.length}`);
    
    console.log("\nSample Row Mapping Data:");
    let printed = 0;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.root_name || row.root_origin_name) {
            console.log(`Row ${i + 2}:`);
            console.log(`  root_name:        "${row.root_name}"`);
            console.log(`  root_origin_name: "${row.root_origin_name}"`);
            console.log(`  productId:        "${row.productId}"`);
            printed++;
            if (printed >= 5) break;
        }
    }
} catch (error) {
    console.error("Verification Error:", error);
}
