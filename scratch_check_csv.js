const fs = require('fs');
const readline = require('readline');
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
async function run() {
    const rl = readline.createInterface({ input: fs.createReadStream('research_results_multiplied.csv') });
    let headers = [];
    let i = 0;
    let drComboIdx = -1, drcIdx = -1, allNullIdx = -1;
    let labPrefixes = [];
    let buffer = '';
    let inQuotes = false;
    for await (const line of rl) {
        let quoteCount = 0;
        for (let j = 0; j < line.length; j++) if (line[j] === '"') quoteCount++;
        if (quoteCount % 2 !== 0) inQuotes = !inQuotes;
        buffer += line;
        if (inQuotes) { buffer += '\n'; continue; }
        if (!buffer.trim() && !inQuotes) { buffer = ''; continue; }
        const row = parseCSVLine(buffer);
        buffer = '';
        if (i === 0) {
            headers = row;
            allNullIdx = headers.indexOf('diseases_rate_all_null');
            drcIdx = headers.indexOf('dynamic_root_causes');
            for(const h of headers) if(h.startsWith('lab_measure_') && h.endsWith('_benefit')) labPrefixes.push(h.replace('_benefit', ''));
        } else {
            const allNull = row[allNullIdx];
            if (allNull !== '0') {
                const drc = row[drcIdx];
                let isDrcEmptyOrNull = true;
                if (drc && drc !== 'NULL' && drc !== '{}' && drc !== '[]' && drc !== '') {
                    try {
                        const parsed = JSON.parse(drc);
                        if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0) {
                            for (let key in parsed) {
                                const rc = parsed[key];
                                const name = rc.name;
                                const be = rc.benefit_exactly;
                                const bd = rc.benefit_descriptive;
                                if ((name && name !== 'null' && name !== 'None' && name !== '') ||
                                    (be && be !== 'null' && be !== 'None' && be !== '') ||
                                    (bd && bd !== 'null' && bd !== 'None' && bd !== '')) {
                                    isDrcEmptyOrNull = false;
                                    break;
                                }
                            }
                        }
                    } catch(e) {}
                }
                
                let isLabsEmptyOrNull = true;
                for(const p of labPrefixes) {
                    const n = row[headers.indexOf(p+'_name')];
                    const b = row[headers.indexOf(p+'_benefit')];
                    const s = row[headers.indexOf(p+'_short_description')];
                    const q = row[headers.indexOf(p+'_quantity')];
                    // Also check type? Let's check if the user considers a lab with ONLY "type" as valid.
                    const t = row[headers.indexOf(p+'_type')];

                    if ((n && n !== 'NULL' && n !== 'null' && n !== 'None' && n !== '') ||
                        (b && b !== 'NULL' && b !== 'null' && b !== 'None' && b !== '') ||
                        (s && s !== 'NULL' && s !== 'null' && s !== 'None' && s !== '') ||
                        (q && q !== 'NULL' && q !== 'null' && q !== 'None' && q !== '')) {
                        isLabsEmptyOrNull = false;
                        break;
                    }
                }
                
                if (isDrcEmptyOrNull && isLabsEmptyOrNull) {
                    console.log('Row ' + i + ' should be zero but is ' + allNull + '. drc: ' + drc);
                }
            }
        }
        i++;
        if (i > 5000) break; // Check first 5000
    }
}
run();
