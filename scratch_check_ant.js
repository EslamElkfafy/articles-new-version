const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, 'SimpleTabulation-ICD-11-MMS-en.xlsx');

console.log('Loading workbook...');
const workbook = XLSX.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(worksheet);


console.log('Searching for any row with title containing "insulin"...');
for (const row of rows) {
  const title = row['Title'] || '';
  if (title.toLowerCase().includes('insulin')) {
    console.log(`Code: ${row['Code'] || row['BlockId']}, Title: "${title}", ClassKind: ${row['ClassKind']}`);
  }
}
