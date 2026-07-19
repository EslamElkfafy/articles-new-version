const xlsx = require('xlsx');

async function sortExcel() {
    console.log("Loading excel file... This may take a while for large files.");
    const inputFilePath = 'new_script_mapping11_mapped.xlsx';
    const outputFilePath = 'new_script_mapping11_mapped_sorted.xlsx';

    try {
        const workbook = xlsx.readFile(inputFilePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        console.log("Parsing data to JSON...");
        let data = xlsx.utils.sheet_to_json(worksheet, { defval: "" });

        if (data.length === 0) {
            console.log("File is empty.");
            return;
        }

        // Find the actual keys for productid and diseaseid (case-insensitive search)
        const keys = Object.keys(data[0]);
        const productIdKey = keys.find(k => k.toLowerCase().replace(/\s/g, '') === 'productid');
        const diseaseIdKey = keys.find(k => k.toLowerCase().replace(/\s/g, '') === 'diseaseid');

        console.log(`Found columns: Product ID -> '${productIdKey}', Disease ID -> '${diseaseIdKey}'`);

        if (!productIdKey && !diseaseIdKey) {
            console.log("Warning: Could not find productid or diseaseid columns in the file!");
        }

        console.log("Sorting data by productid and diseaseid...");
        data.sort((a, b) => {
            let pidA = String(a[productIdKey] || "");
            let pidB = String(b[productIdKey] || "");
            
            // Compare productid first (numeric sort)
            let cmpPid = pidA.localeCompare(pidB, undefined, { numeric: true, sensitivity: 'base' });
            if (cmpPid !== 0) return cmpPid;
            
            // If productid is equal, compare diseaseid (numeric sort)
            let didA = String(a[diseaseIdKey] || "");
            let didB = String(b[diseaseIdKey] || "");
            
            return didA.localeCompare(didB, undefined, { numeric: true, sensitivity: 'base' });
        });

        console.log("Writing to new sheet...");
        const newWorksheet = xlsx.utils.json_to_sheet(data);
        const newWorkbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(newWorkbook, newWorksheet, sheetName);

        console.log(`Saving new excel file to ${outputFilePath}...`);
        xlsx.writeFile(newWorkbook, outputFilePath);

        console.log("Done! File sorted successfully.");
    } catch (error) {
        console.error("Error processing Excel file:", error.message);
    }
}

sortExcel();
