const xlsx = require('xlsx');

const file = 'Hypertension_recalculated.xlsx';
const workbook = xlsx.readFile(file);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json(sheet, { defval: null });

console.log('Total rows:', data.length);
if (data.length > 0) {
    console.log('Columns:', Object.keys(data[0]));
    
    // Check how many have both null
    let bothNull = 0;
    let anyNull = 0;
    let itemNull = 0;
    let anotherNull = 0;
    
    for (const row of data) {
        const itemEmpty = (row['item name'] === null || row['item name'] === undefined || row['item name'] === '');
        const anotherEmpty = (row['anthor item'] === null || row['anthor item'] === undefined || row['anthor item'] === '');
        
        if (itemEmpty) itemNull++;
        if (anotherEmpty) anotherNull++;
        if (itemEmpty && anotherEmpty) bothNull++;
        if (itemEmpty || anotherEmpty) anyNull++;
    }
    
    console.log(`item name null: ${itemNull}`);
    console.log(`anthor item null: ${anotherNull}`);
    console.log(`Both null: ${bothNull}`);
    console.log(`Any null: ${anyNull}`);
}
