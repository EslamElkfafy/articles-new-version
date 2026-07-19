const fs = require('fs');
const path = require('path');

const csvPath = path.join(__dirname, 'Production DR.csv');
const backupCsvPath = path.join(__dirname, 'Production DR_backup.csv');
const diseasesCsvPath = path.join(__dirname, 'diseases_202607042232.csv');

// Helper functions for parsing CSV
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

function formatCSVLine(cells) {
    return cells.map(cell => {
        if (cell === null || cell === undefined) return '';
        const str = String(cell);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    }).join(',');
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
    const cleanCSV = csvDisease.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    
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

console.log('🔄 Reading Production DR.csv...');
if (!fs.existsSync(csvPath)) {
    console.error(`❌ Production DR.csv not found at ${csvPath}`);
    process.exit(1);
}
const csvContent = fs.readFileSync(csvPath, 'utf8');
const csvLines = csvContent.split('\n');
const headers = parseCSVLine(csvLines[0].trim());

const diseaseColIndex = headers.indexOf('disease');
const diseaseIdColIndex = headers.indexOf('diseaseId');

if (diseaseColIndex === -1 || diseaseIdColIndex === -1) {
    console.error('❌ CSV headers must contain both "disease" and "diseaseId". Found headers:', headers);
    process.exit(1);
}

fs.writeFileSync(backupCsvPath, csvContent, 'utf8');
console.log(`💾 Created backup at ${backupCsvPath}`);

let mappedCount = 0;
let unmatchedCount = 0;
const unmatchedNames = new Set();

const updatedLines = [csvLines[0]];

for (let i = 1; i < csvLines.length; i++) {
    const line = csvLines[i].trim();
    if (!line) continue;
    
    const parts = parseCSVLine(line);
    const diseaseName = parts[diseaseColIndex];
    
    const newId = getMatch(diseaseName);
    
    if (newId !== null) {
        parts[diseaseIdColIndex] = String(newId);
        mappedCount++;
    } else {
        parts[diseaseIdColIndex] = '0';
        unmatchedCount++;
        if (diseaseName) {
            unmatchedNames.add(diseaseName);
        }
    }
    
    updatedLines.push(formatCSVLine(parts));
}

fs.writeFileSync(csvPath, updatedLines.join('\n'), 'utf8');

console.log('\n======================================');
console.log('📈 MIGRATION STATS:');
console.log(`- Total processed lines: ${csvLines.length - 1}`);
console.log(`- Successfully mapped lines: ${mappedCount}`);
console.log(`- Unmatched lines: ${unmatchedCount}`);
console.log(`- Unmatched unique disease names: ${unmatchedNames.size}`);
if (unmatchedNames.size > 0) {
    console.log('  ⚠️ Unmatched names list:', Array.from(unmatchedNames));
}
console.log('======================================\n');
console.log('✅ Overwritten Production DR.csv successfully.');
