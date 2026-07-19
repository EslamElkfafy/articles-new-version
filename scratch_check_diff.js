const XLSX = require('xlsx');
const path = require('path');

const fileOrig = path.join(__dirname, 'Diabetes_Mellitus_Type_2_recalculated.xlsx');
const fileNew = path.join(__dirname, 'recalculated_new_script_mapping11.xlsx');

function dumpProduct(file, productId) {
    const wb = XLSX.readFile(file);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    
    // find rows with productId
    const pRows = rows.filter(r => r.productId == productId || r.product_id == productId || r.id == productId);
    
    // filter for diabetes
    const diabetesRows = pRows.filter(r => {
        const disease = r.disease_name || r.disease || '';
        return disease === '' || String(disease).toLowerCase().includes('diabetes') || String(disease).toLowerCase().includes('mellitus');
    });

    console.log(`\n--- File: ${path.basename(file)} ---`);
    console.log(`Found ${diabetesRows.length} rows for Product ID ${productId}`);
    
    const uniqueArticles = new Map();
    for (const r of diabetesRows) {
        const key = String(r.PMID || r.pubmed || r.title || r.id).trim();
        const rate = r.disease_rate_combination;
        if (!uniqueArticles.has(key)) {
            uniqueArticles.set(key, rate);
        }
    }
    
    const uniqueArr = Array.from(uniqueArticles.entries());
    console.log(`Unique Articles: ${uniqueArr.length}`);
    const rates = uniqueArr.map(x => parseFloat(x[1]) || 0);
    const sum = rates.reduce((a,b)=>a+b, 0);
    const max = rates.length > 0 ? Math.max(...rates) : 0;
    
    console.log(`Rates:`, rates);
    console.log(`Sum: ${sum}, Max: ${max}, Calculated DW (sum * max): ${sum * max}`);
    
    console.log("Articles Details:");
    uniqueArr.slice(0, 5).forEach((val, idx) => console.log(`  ${idx+1}: ${val[0]} (Rate: ${val[1]})`));
    if (uniqueArr.length > 5) console.log(`  ... and ${uniqueArr.length - 5} more.`);
}

dumpProduct(fileOrig, 37);
dumpProduct(fileNew, 37);
