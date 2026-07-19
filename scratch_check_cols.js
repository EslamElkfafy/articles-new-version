const XLSX = require('xlsx');
const path = require('path');

try {
    const excelPath = path.join(__dirname, 'recalculated_new_script_mapping11.xlsx');
    console.log("Loading workbook from:", excelPath);
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const headers = [];
    for (let C = range.s.c; C <= range.e.c; ++C) {
        const addr = XLSX.utils.encode_cell({ r: range.s.r, c: C });
        const cell = sheet[addr];
        if (cell && cell.v !== undefined) {
            headers.push(String(cell.v).trim());
        }
    }
    console.log("Headers:", headers);
} catch (error) {
    console.error("Error:", error);
}
