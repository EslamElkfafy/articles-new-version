const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// You can swap this to './Ai_ollama' if you prefer to use the local Ollama model
const extractWithAI = require('./Ai'); 

const EXCEL_FILE = path.join(__dirname, 'new_script_mapping11.xlsx');
const ROOTS_FILE = path.join(__dirname, 'Full-Roots.json');
const OUTPUT_FILE = path.join(__dirname, 'new_script_mapping11_mapped.xlsx');

async function main() {
    console.log(`Loading Roots from ${ROOTS_FILE}...`);
    const rootsData = JSON.parse(fs.readFileSync(ROOTS_FILE, 'utf8'));
    
    // We only care about Root names, ignore 'Best MeSH match' as requested.
    const validRootsMap = new Map(); // Root Name -> ID
    const validRootsList = []; // For the prompt
    for (const r of rootsData) {
        if (r.Root && r.id) {
            const rootName = r.Root.trim();
            validRootsMap.set(rootName.toLowerCase(), r.id);
            if (!validRootsList.includes(rootName)) {
                validRootsList.push(rootName);
            }
        }
    }
    console.log(`Loaded ${validRootsList.length} unique roots.`);

    console.log(`Loading Excel from ${EXCEL_FILE}...`);
    const workbook = XLSX.readFile(EXCEL_FILE);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`Loaded ${data.length} rows from Excel.`);

    // Extract unique product names from the Excel to minimize AI calls
    const uniqueProducts = new Set();
    const nameKeys = ['root_name', 'product', 'item_name', 'name', 'disease']; // potential column names
    
    // Explicitly use 'root_name' as the product column, as requested by the user.
    const productColumnName = 'root_name';

    console.log(`Assuming product name column is: '${productColumnName}'`);

    for (const row of data) {
        const prodName = row[productColumnName];
        if (prodName) {
            uniqueProducts.add(prodName.toString().trim());
        }
    }

    console.log(`Found ${uniqueProducts.size} unique products to map.`);

    const aiMappingCache = new Map(); // prodName -> matched Root Name (or null)

    const productsToMap = [];
    for (const prodName of uniqueProducts) {
        const prodLower = prodName.toLowerCase();
        
        // Check exact match first
        if (validRootsMap.has(prodLower)) {
            aiMappingCache.set(prodName, prodName);
            continue;
        }
        productsToMap.push(prodName);
    }

    console.log(`Need to map ${productsToMap.length} products using AI.`);
    const BATCH_SIZE = 20;

    for (let i = 0; i < productsToMap.length; i += BATCH_SIZE) {
        const batch = productsToMap.slice(i, i + BATCH_SIZE);
        console.log(`\nQuerying AI for batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(productsToMap.length / BATCH_SIZE)} (Size: ${batch.length})...`);
        
        const prompt = `
        You are a medical and botanical data mapping assistant.
        We have a list of product names.
        Map EACH product to the most appropriate "Root" name from the list of valid Roots below.
        CRITICAL RULE: You must map products that are physically, chemically, or biologically similar to each other (e.g., sharing the same active compounds, being varieties of the same plant, or having identical medicinal/nutritional properties).
        Do NOT rely on simple text/fuzzy matching. Use your deep scientific knowledge to find the best match based on physical and chemical similarity.
        If there is no logically similar or related Root in the list for a specific product, return "NOT_FOUND" for that product.
        Respond ONLY in a single valid JSON object format where keys are the exact product names and values are the exact mapped Root names or "NOT_FOUND".
        Example response:
        {
          "Product A": "Root Name here",
          "Product B": "NOT_FOUND"
        }
        
        Products to map:
        ${JSON.stringify(batch, null, 2)}
        
        List of valid Roots:
        ${validRootsList.join(', ')}
        `;

        try {
            const resultStr = await extractWithAI(prompt);
            if (resultStr) {
                // Find JSON in the response
                const match = resultStr.match(/\{[\s\S]*\}/);
                if (match) {
                    const parsed = JSON.parse(match[0]);
                    for (const prodName of batch) {
                        const mappedRoot = parsed[prodName] || parsed[prodName.trim()];
                        if (mappedRoot && mappedRoot !== "NOT_FOUND" && validRootsMap.has(mappedRoot.toLowerCase())) {
                            console.log(`✅ AI Mapped: "${prodName}" -> "${mappedRoot}"`);
                            aiMappingCache.set(prodName, mappedRoot);
                        } else {
                            console.log(`❌ AI could not map: "${prodName}" (Response: ${mappedRoot})`);
                            aiMappingCache.set(prodName, null);
                        }
                    }
                } else {
                    console.log(`❌ Invalid JSON from AI for batch.`);
                    batch.forEach(p => aiMappingCache.set(p, null));
                }
            } else {
                console.log(`❌ AI failed for batch.`);
                batch.forEach(p => aiMappingCache.set(p, null));
            }
        } catch (e) {
            console.error(`Error querying AI for batch:`, e.message);
            batch.forEach(p => aiMappingCache.set(p, null));
        }
        
        // Small delay to avoid rate limits
         await new Promise(res => setTimeout(res, 500));
    }

    console.log(`\nMapping complete. Updating Excel data...`);
    let mappedCount = 0;
    let notFoundCount = 0;

    for (const row of data) {
        const prodName = row[productColumnName];
        let rootId = 0; // Default to 0 if not found

        if (prodName) {
            const mappedRoot = aiMappingCache.get(prodName.toString().trim());
            if (mappedRoot) {
                const id = validRootsMap.get(mappedRoot.toLowerCase());
                if (id) {
                    rootId = id;
                    mappedCount++;
                }
            }
        }

        if (rootId === 0) {
            notFoundCount++;
        }

        // Set the productid in the row (using exact casing if it existed, otherwise 'productid')
        let idKey = 'productid';
        for (const key of Object.keys(row)) {
            if (key.toLowerCase() === 'productid' || key.toLowerCase() === 'product_id') {
                idKey = key;
                break;
            }
        }
        row[idKey] = rootId;
    }

    console.log(`Mapped: ${mappedCount}, Not Found (ID=0): ${notFoundCount}`);
    
    console.log(`Saving to ${OUTPUT_FILE}...`);
    const newWorksheet = XLSX.utils.json_to_sheet(data);
    const newWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, sheetName);
    XLSX.writeFile(newWorkbook, OUTPUT_FILE);
    
    console.log(`Done! Mapped file saved to ${OUTPUT_FILE}`);
}

main().catch(console.error);
