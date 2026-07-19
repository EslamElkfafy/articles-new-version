const fs = require('fs');
const readline = require('readline');

const inputFilePath = 'research_results (All Ready Diabetes After 15 Retry Run).csv';
const outputFilePath = 'research_results_updated.csv';

// Simple CSV line parser that respects quotes
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' && line[i+1] === '"') {
            current += '"';
            i++;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

// Escapes values for CSV output
function escapeCSV(val) {
    if (val === null || val === undefined) return '';
    val = String(val);
    if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
        return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
}

async function processCSV() {
    console.log(`Reading from: ${inputFilePath}`);
    const fileStream = fs.createReadStream(inputFilePath, 'utf8');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const outStream = fs.createWriteStream(outputFilePath, 'utf8');

    let headers = [];
    let diseaseRatesIdx = -1;
    let aiRateIdx = -1;
    let allNullIdx = -1;
    let newColIdx = -1;
    
    let isFirstLine = true;
    let rowCount = 0;

    let buffer = '';
    let inQuotes = false;

    for await (const line of rl) {
        let quoteCount = 0;
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '"') quoteCount++;
        }
        if (quoteCount % 2 !== 0) {
            inQuotes = !inQuotes;
        }
        
        buffer += line;
        
        if (inQuotes) {
            buffer += '\n';
            continue;
        }

        if (!buffer.trim() && !inQuotes) {
            buffer = '';
            continue;
        }

        const row = parseCSVLine(buffer);
        buffer = '';

        if (isFirstLine) {
            headers = row;
            diseaseRatesIdx = headers.indexOf('disease_rates');
            aiRateIdx = headers.indexOf('ai_calculated_rate');
            allNullIdx = headers.indexOf('diseases_rate_all_null');
            
            // Need dynamic_root_causes to verify if it's truly empty
            this.drcIdx = headers.indexOf('dynamic_root_causes');
            
            // Find lab prefixes and indices BEFORE splicing headers
            this.labIndices = [];
            let tempPrefixes = [];
            for (let i = 0; i < headers.length; i++) {
                if (headers[i].startsWith('lab_measure_') && headers[i].endsWith('_type')) {
                    tempPrefixes.push(headers[i].replace('_type', ''));
                } else if (headers[i].startsWith('lab_measure_') && headers[i].endsWith('_benefit')) {
                    const prefix = headers[i].replace('_benefit', '');
                    if (!tempPrefixes.includes(prefix)) {
                        tempPrefixes.push(prefix);
                    }
                }
            }
            for (const prefix of tempPrefixes) {
                this.labIndices.push({
                    typeIdx: headers.indexOf(prefix + '_type'),
                    nameIdx: headers.indexOf(prefix + '_name'),
                    benefitIdx: headers.indexOf(prefix + '_benefit'),
                    shortDescIdx: headers.indexOf(prefix + '_short_description'),
                    quantityIdx: headers.indexOf(prefix + '_quantity')
                });
            }
            
            if (diseaseRatesIdx === -1 || aiRateIdx === -1 || allNullIdx === -1) {
                console.error("Could not find required columns in the CSV header.");
                process.exit(1);
            }

            // Insert new column right after ai_calculated_rate
            newColIdx = aiRateIdx + 1;
            headers.splice(newColIdx, 0, 'disease_rate_combination');
            
            outStream.write(headers.map(escapeCSV).join(',') + '\n');
            isFirstLine = false;
        } else {
            const drRaw = row[diseaseRatesIdx];
            const aiRaw = row[aiRateIdx];
            const allNullRaw = row[allNullIdx];

            let dr_val = parseFloat(drRaw);
            let ai_val = parseFloat(aiRaw);
            let allNull_val = parseFloat(allNullRaw);
            
            // Verify if actually empty
            let hasValidDrc = false;
            if (this.drcIdx !== -1) {
                const drcRaw = row[this.drcIdx];
                if (drcRaw && drcRaw !== 'NULL' && drcRaw !== '{}' && drcRaw !== '[]' && drcRaw !== '') {
                    try {
                        const parsed = JSON.parse(drcRaw);
                        if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0) {
                            hasValidDrc = true;
                        }
                    } catch(e) {}
                }
            }
            
            let hasValidLabs = false;
            for (const indices of this.labIndices) {
                const t = indices.typeIdx !== -1 ? row[indices.typeIdx] : null;
                const n = indices.nameIdx !== -1 ? row[indices.nameIdx] : null;
                const b = indices.benefitIdx !== -1 ? row[indices.benefitIdx] : null;
                const s = indices.shortDescIdx !== -1 ? row[indices.shortDescIdx] : null;
                const q = indices.quantityIdx !== -1 ? row[indices.quantityIdx] : null;
                
                if ((t && t !== 'NULL' && t !== 'null' && t !== '') ||
                    (n && n !== 'NULL' && n !== 'null' && n !== '') ||
                    (b && b !== 'NULL' && b !== 'null' && b !== '') ||
                    (s && s !== 'NULL' && s !== 'null' && s !== '') ||
                    (q && q !== 'NULL' && q !== 'null' && q !== '')) {
                    hasValidLabs = true;
                    break;
                }
            }

            let combination = "";

            if (allNull_val === 0 || (!hasValidDrc && !hasValidLabs)) {
                combination = 0;
                row[allNullIdx] = 0; // Overwrite the diseases_rate_all_null column to be 0
            } else if (!isNaN(dr_val) && dr_val > 0) {
                combination = dr_val;
            } else {
                combination = !isNaN(ai_val) ? ai_val : 0;
            }

            row.splice(newColIdx, 0, combination);
            outStream.write(row.map(escapeCSV).join(',') + '\n');
            
            rowCount++;
            if (rowCount % 1000 === 0) {
                console.log(`Processed ${rowCount} rows...`);
            }
        }
    }

    outStream.end();
    console.log(`\nProcessing complete! Processed ${rowCount} rows.`);
    console.log(`Saved updated file to: ${outputFilePath}`);
}

processCSV().catch(console.error);
