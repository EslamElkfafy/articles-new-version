const xlsx = require('xlsx');
const wb = xlsx.readFile('new_script_mapping11.xlsx', { sheetRows: 10 });
const ws = wb.Sheets[wb.SheetNames[0]];
console.log(xlsx.utils.sheet_to_json(ws)[0]);
