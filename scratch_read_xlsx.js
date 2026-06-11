const XLSX = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, 'SimpleTabulation-ICD-11-MMS-en.xlsx');

console.log('Loading workbook...');
const workbook = XLSX.readFile(filePath);
console.log('Sheet names:', workbook.SheetNames);

const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

console.log('Reading first 10 rows...');
const range = XLSX.utils.decode_range(worksheet['!ref']);
console.log('Range:', range);

const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: 0 });
console.log('Header rows (first 10):');
for (let i = 0; i < Math.min(10, data.length); i++) {
  console.log(`Row ${i}:`, data[i]);
}
