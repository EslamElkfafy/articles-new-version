const XLSX = require('xlsx');
const path = require('path');

function searchFile(fileName) {
    const filePath = path.join(__dirname, fileName);
    console.log(`\n=================== Searching ${fileName} ===================`);
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet);
        
        console.log(`Loaded ${rows.length} rows.`);
        const matches = rows.filter(row => {
            return Object.values(row).some(val => val !== null && String(val).toLowerCase().includes('apple'));
        });
        
        console.log(`Found ${matches.length} matches with 'apple' in values:`);
        matches.forEach((row, index) => {
            console.log(`Match ${index + 1}:`, {
                id: row.id,
                productId: row.productId,
                product: row.product,
                Root: row.Root,
                root_name: row.root_name,
                item: row.item,
                diseaseId: row.diseaseId,
                title: row.title ? row.title.substring(0, 60) + '...' : ''
            });
        });
    } catch (err) {
        console.error(`Error processing ${fileName}:`, err.message);
    }
}

searchFile('new_script_mapping11.xlsx');
searchFile('recalculated_new_script_mapping11.xlsx');
