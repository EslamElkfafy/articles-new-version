const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const xlsxPath = path.join(__dirname, 'DR_production_Full_rates_IDs_0_removed_D_R.xlsx');
const backupXlsxPath = path.join(__dirname, 'DR_production_Full_rates_IDs_0_removed_D_R_backup.xlsx');
const diseasesCsvPath = path.join(__dirname, 'diseases_202607042232.csv');

// Helper function for parsing CSV line safely
function parseCSVLine(line) {
    const result = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cell += '"';
                i++; // Skip next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(cell);
            cell = '';
        } else {
            cell += char;
        }
    }
    result.push(cell);
    return result;
}

console.log('🔄 Loading diseases list from diseases_202607042232.csv...');
if (!fs.existsSync(diseasesCsvPath)) {
    console.error(`❌ Diseases file not found at ${diseasesCsvPath}`);
    process.exit(1);
}
const diseasesContent = fs.readFileSync(diseasesCsvPath, 'utf8');
const diseaseLines = diseasesContent.split('\n');

const diseases = [];
for (let i = 1; i < diseaseLines.length; i++) {
    const line = diseaseLines[i].trim();
    if (!line) continue;
    
    const parts = parseCSVLine(line);
    const id = parseInt(parts[0], 10);
    const jsonStr = parts[1];
    
    let en = '';
    let ar = '';
    try {
        const parsed = JSON.parse(jsonStr);
        en = parsed.en || '';
        ar = parsed.ar || '';
    } catch (e) {
        en = jsonStr;
    }
    
    diseases.push({ id, en, ar });
}

if (!diseases.some(d => d.id === 92)) {
    diseases.push({ id: 92, en: 'Longevity', ar: 'إطالة العمر' });
}

console.log(`✅ Loaded ${diseases.length} diseases for mapping.`);

function getMatch(csvDisease) {
    if (!csvDisease) return null;
    const cleanCSV = String(csvDisease).toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    
    for (const d of diseases) {
        if (d.en) {
            const cleanEn = d.en.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleanCSV === cleanEn) return d.id;
        }
    }
    
    const manualMappings = {
        'type 2 diabetes': 28,
        'type 2 diabetes mellitus': 28,
        'hypertension': 84,
        'cardiovascular disease': 37,
        'dyslipidemia': 38,
        'obesity': 82,
        'alzheimer s disease': 83,
        'alzheimers disease': 83,
        'breast cancer': 51,
        'nonalcoholic fatty liver disease': 86,
        'non alcoholic fatty liver disease': 86,
        'prediabetes': 46,
        'longevity': 92,
        'inflammation': 48,
        'common cold': 63,
        'constipation': 66,
        'crohns disease': 67,
        'crohn s disease': 67,
        'colitis': 71,
        'metabolic syndrome': 49,
        'melanoma': 50,
        'liver cirrhosis': 73,
        'stomach ulcer': 74,
        'inflammatory bowel disease': 39,
        'inflammatory bowel diseases': 39,
        'colorectal neoplasms': 47,
        'parkinson s': 70,
        'parkinson s disease': 70,
        'parkinsons disease': 70,
        'skin aging': 76,
        'pressure ulcer': 77,
    };

    if (manualMappings[cleanCSV]) {
        return manualMappings[cleanCSV];
    }
    
    for (const d of diseases) {
        if (d.en) {
            const cleanEn = d.en.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleanEn.includes(cleanCSV) || cleanCSV.includes(cleanEn)) {
                return d.id;
            }
        }
    }

    return null;
}

console.log(`🔄 Reading Excel file: ${xlsxPath}...`);
if (!fs.existsSync(xlsxPath)) {
    console.error(`❌ Excel file not found at ${xlsxPath}`);
    process.exit(1);
}

// Create backup first
fs.copyFileSync(xlsxPath, backupXlsxPath);
console.log(`💾 Created backup at ${backupXlsxPath}`);

const workbook = XLSX.readFile(xlsxPath);
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Read rows as JSON objects
const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
console.log(`📊 Found ${rows.length} rows in the sheet.`);

if (rows.length === 0) {
    console.error('❌ Excel sheet is empty.');
    process.exit(1);
}

// Find header names dynamically (case-insensitive)
const firstRow = rows[0];
const keys = Object.keys(firstRow);
const diseaseCol = keys.find(k => k.toLowerCase() === 'disease');
const diseaseIdCol = keys.find(k => k.toLowerCase() === 'diseaseid' || k.toLowerCase() === 'diseasesid');

if (!diseaseCol || !diseaseIdCol) {
    console.error(`❌ Could not identify the required columns. Available columns: ${keys.join(', ')}`);
    process.exit(1);
}

console.log(`ℹ️ Match mapping columns: Name -> "${diseaseCol}", ID -> "${diseaseIdCol}"`);

let mappedCount = 0;
let unmatchedCount = 0;
const unmatchedNames = new Set();

for (const row of rows) {
    const diseaseName = row[diseaseCol];
    const newId = getMatch(diseaseName);
    
    if (newId !== null) {
        row[diseaseIdCol] = newId;
        mappedCount++;
    } else {
        row[diseaseIdCol] = 0;
        unmatchedCount++;
        if (diseaseName) {
            unmatchedNames.add(String(diseaseName));
        }
    }
}

// Write JSON back to sheet
const newWorksheet = XLSX.utils.json_to_sheet(rows);
workbook.Sheets[sheetName] = newWorksheet;
XLSX.writeFile(workbook, xlsxPath);

console.log('\n======================================');
console.log('📈 MIGRATION STATS:');
console.log(`- Total processed rows: ${rows.length}`);
console.log(`- Successfully mapped rows: ${mappedCount}`);
console.log(`- Unmatched rows (set to 0): ${unmatchedCount}`);
console.log(`- Unmatched unique disease names: ${unmatchedNames.size}`);
if (unmatchedNames.size > 0) {
    console.log('  ⚠️ Unmatched names list:', Array.from(unmatchedNames));
}
console.log('======================================\n');
console.log('✅ Overwritten Excel file successfully.');
