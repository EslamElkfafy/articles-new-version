const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// File paths
const newScriptFile = path.join(__dirname, 'recalculated_new_script_mapping11.xlsx');
const originalScriptFile = path.join(__dirname, 'Diabetes_Mellitus_Type_2_recalculated.xlsx');
const outputMd = path.join(__dirname, 'diabetes_dw_comparison.md');
const outputCsv = path.join(__dirname, 'diabetes_dw_comparison.csv');

// Helper to normalize strings for comparison/checks
function normalize(str) {
    if (!str) return '';
    return String(str).toLowerCase().trim()
        .replace(/[^a-z0-9]/g, '');
}

// Helper to find standard columns in row objects
function getProductInfo(row) {
    const nameKeys = ['root_name', 'root', 'product', 'item', 'name_en', 'name', 'scientific_name', 'item_name'];
    const dwKeys = ['calculated_dw', 'dw', 'calculated dw', 'calculated_dw_value', 'calculateddw'];
    const diseaseKeys = ['disease_name', 'disease', 'disease_id', 'diseaseid'];
    
    // Prioritize productId/product_id over simple id
    const productIdKeys = ['productid', 'productId', 'product_id', 'id', 'item_id', 'itemid', 'root_id', 'root_ID'];

    let name = '';
    for (const key of nameKeys) {
        const foundKey = Object.keys(row).find(k => k.toLowerCase() === key);
        if (foundKey && row[foundKey] !== undefined) {
            name = String(row[foundKey]).trim();
            break;
        }
    }

    let dw = null;
    for (const key of dwKeys) {
        const foundKey = Object.keys(row).find(k => k.toLowerCase() === key);
        if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) {
            dw = parseFloat(row[foundKey]);
            break;
        }
    }

    let disease = '';
    for (const key of diseaseKeys) {
        const foundKey = Object.keys(row).find(k => k.toLowerCase() === key);
        if (foundKey && row[foundKey] !== undefined) {
            disease = String(row[foundKey]).trim();
            break;
        }
    }

    // Specifically extract productId
    let productId = null;
    for (const key of productIdKeys) {
        const foundKey = Object.keys(row).find(k => k.toLowerCase() === key);
        if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) {
            const parsedVal = parseInt(row[foundKey], 10);
            if (!isNaN(parsedVal)) {
                productId = parsedVal;
                break;
            }
        }
    }

    return { productId, name, dw, disease };
}

// Heuristic to find the most frequent name for a product group
function getMostFrequentName(rows) {
    const nameCounts = new Map();
    rows.forEach(r => {
        const { name } = getProductInfo(r);
        if (!name || name.toLowerCase() === 'null' || name.toLowerCase() === 'undefined') return;
        const key = name.trim();
        const lowerKey = key.toLowerCase();
        
        if (!nameCounts.has(lowerKey)) {
            nameCounts.set(lowerKey, { original: key, count: 0 });
        }
        nameCounts.get(lowerKey).count++;
    });

    let bestName = 'N/A';
    let maxCount = -1;
    for (const val of nameCounts.values()) {
        if (val.count > maxCount) {
            maxCount = val.count;
            bestName = val.original;
        }
    }
    return bestName;
}

function runComparison() {
    console.log('🔄 Starting Excel Comparison (Matched by Product ID, Auto-Healing Names)...');

    // 1. Check if files exist
    if (!fs.existsSync(newScriptFile)) {
        console.error(`❌ Error: File not found at ${newScriptFile}`);
        return;
    }
    if (!fs.existsSync(originalScriptFile)) {
        console.error(`❌ Error: File not found at ${originalScriptFile}`);
        return;
    }

    // 2. Load recalculated_new_script_mapping11.xlsx (New Script)
    console.log(`📂 Loading new script workbook: ${newScriptFile}...`);
    const wbNew = XLSX.readFile(newScriptFile);
    const newSheet = wbNew.Sheets[wbNew.SheetNames[0]];
    const newRows = XLSX.utils.sheet_to_json(newSheet);
    console.log(`✅ Loaded ${newRows.length} rows from new script.`);

    // 3. Load Diabetes_Mellitus_Type_2_recalculated.xlsx (Original Script)
    console.log(`📂 Loading original script workbook: ${originalScriptFile}...`);
    const wbOrig = XLSX.readFile(originalScriptFile);
    const origSheet = wbOrig.Sheets[wbOrig.SheetNames[0]];
    const origRows = XLSX.utils.sheet_to_json(origSheet);
    console.log(`✅ Loaded ${origRows.length} rows from original script.`);

    // Group rows by productId
    const newProductGroups = new Map(); // productId -> Array of rows
    const origProductGroups = new Map(); // productId -> Array of rows

    newRows.forEach(row => {
        const { productId } = getProductInfo(row);
        if (productId === 0 || productId === null || productId === undefined) return;
        if (!newProductGroups.has(productId)) {
            newProductGroups.set(productId, []);
        }
        newProductGroups.get(productId).push(row);
    });

    origRows.forEach(row => {
        const { productId } = getProductInfo(row);
        if (productId === 0 || productId === null || productId === undefined) return;
        if (!origProductGroups.has(productId)) {
            origProductGroups.set(productId, []);
        }
        origProductGroups.get(productId).push(row);
    });

    // 4. Match and compare
    console.log('📊 Comparing DW values and resolving best product names...');
    const comparisonResults = [];
    const allProductIds = new Set([...newProductGroups.keys(), ...origProductGroups.keys()]);

    allProductIds.forEach((pid) => {
        const newGroup = newProductGroups.get(pid) || [];
        const origGroup = origProductGroups.get(pid) || [];

        // 1) Find the most frequent name in each group to clean up noise (like 'plants')
        const newName = newGroup.length > 0 ? getMostFrequentName(newGroup) : 'N/A';
        const origName = origGroup.length > 0 ? getMostFrequentName(origGroup) : 'N/A';

        // 2) Find the DW value for diabetes in new group
        let newDw = null;
        for (const row of newGroup) {
            const { dw, disease } = getProductInfo(row);
            
            const isDiabetes = !disease || 
                normalize(disease).includes('diabetes') || 
                normalize(disease).includes('mellitus') ||
                normalize(disease).includes('type2') ||
                disease === '';

            if (isDiabetes && dw !== null) {
                newDw = dw;
                break; // Found it
            }
        }

        // 3) Find the DW value for diabetes in original group
        let origDw = null;
        for (const row of origGroup) {
            const { dw } = getProductInfo(row);
            if (dw !== null) {
                origDw = dw;
                break;
            }
        }

        let diff = 'N/A';
        if (newDw !== null && origDw !== null) {
            diff = (newDw - origDw).toFixed(4);
        }

        comparisonResults.push({
            productId: pid,
            newName: newName,
            origName: origName,
            newDw: newDw !== null ? newDw.toFixed(4) : 'N/A',
            origDw: origDw !== null ? origDw.toFixed(4) : 'N/A',
            diff: diff
        });
    });

    // Sort by Product ID numerically
    comparisonResults.sort((a, b) => a.productId - b.productId);

    // 5. Write to Markdown Table
    console.log('✍️ Writing Markdown comparison report...');
    let mdContent = `# Diabetes Mellitus Type 2 - DW Comparison Report\n\n`;
    mdContent += `Comparison between **New Script** (\`recalculated_new_script_mapping11.xlsx\`) and **Original Script** (\`Diabetes_Mellitus_Type_2_recalculated.xlsx\`):\n\n`;
    mdContent += `*Note: Matched by Product ID. Noise in names (like 'plants' matching 'blueberry plants') has been automatically filtered by choosing the most frequent name.*\n\n`;
    mdContent += `| Product ID | New Script Name | Original Script Name | New Script DW | Original Script DW | Difference (New - Original) |\n`;
    mdContent += `| :--- | :--- | :--- | :---: | :---: | :---: |\n`;

    comparisonResults.forEach(r => {
        mdContent += `| ${r.productId} | ${r.newName} | ${r.origName} | ${r.newDw} | ${r.origDw} | ${r.diff} |\n`;
    });

    fs.writeFileSync(outputMd, mdContent, 'utf8');
    console.log(`💾 Saved Markdown report to: ${outputMd}`);

    // 6. Write to CSV
    console.log('✍️ Writing CSV report...');
    let csvContent = `Product ID,New Script Name,Original Script Name,New Script DW,Original Script DW,Difference\n`;
    comparisonResults.forEach(r => {
        const escapedNewName = r.newName.includes(',') ? `"${r.newName}"` : r.newName;
        const escapedOrigName = r.origName.includes(',') ? `"${r.origName}"` : r.origName;
        csvContent += `${r.productId},${escapedNewName},${escapedOrigName},${r.newDw},${r.origDw},${r.diff}\n`;
    });

    fs.writeFileSync(outputCsv, csvContent, 'utf8');
    console.log(`💾 Saved CSV report to: ${outputCsv}`);

    console.log('\n✨ Comparison Complete successfully! Please read the output files.');
}

runComparison();
