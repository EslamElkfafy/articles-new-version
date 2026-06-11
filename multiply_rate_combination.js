const fs = require('fs');
const readline = require('readline');

const inputFilePath = 'research_results_updated.csv';
const outputFilePath = 'research_results_multiplied_FinalFixed.csv';

// Simple CSV line parser that respects quotes
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' && line[i + 1] === '"') {
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
    let drComboIdx = -1;
    let drcIdx = -1; // dynamic_root_causes index
    let newColIdx = -1;

    // To track lab benefit indices
    let labBenefitIndices = [];

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
            drComboIdx = headers.indexOf('disease_rate_combination');
            drcIdx = headers.indexOf('dynamic_root_causes');

            if (drComboIdx === -1) {
                console.error("Could not find 'disease_rate_combination' column in the CSV header.");
                process.exit(1);
            }
            if (drcIdx === -1) {
                console.error("Could not find 'dynamic_root_causes' column in the CSV header.");
                process.exit(1);
            }

            // Find all unique labs by searching headers for lab_measure_..._benefit
            const labPrefixes = new Set();
            for (let i = 0; i < headers.length; i++) {
                if (headers[i].startsWith('lab_measure_') && headers[i].endsWith('_benefit')) {
                    labPrefixes.add(headers[i].replace('_benefit', ''));
                }
            }

            for (const prefix of labPrefixes) {
                labBenefitIndices.push({
                    benefitIdx: headers.indexOf(`${prefix}_benefit`),
                    shortDescIdx: headers.indexOf(`${prefix}_short_description`)
                });
            }

            // Insert new column right after disease_rate_combination
            newColIdx = drComboIdx + 1;
            headers.splice(newColIdx, 0, 'disease_rate_combination_multiplied');

            outStream.write(headers.map(escapeCSV).join(',') + '\n');
            isFirstLine = false;
        } else {
            const drComboRaw = row[drComboIdx];
            const drcRaw = row[drcIdx];

            let drCombo = parseFloat(drComboRaw);
            if (isNaN(drCombo)) drCombo = 0;

            let benefitCount = 0;

            // 1. Count root causes with benefits
            if (drcRaw && drcRaw !== 'NULL' && drcRaw !== '') {
                try {
                    const parsedDrc = JSON.parse(drcRaw);
                    if (typeof parsedDrc === 'object' && parsedDrc !== null) {
                        for (const key of Object.keys(parsedDrc)) {
                            const rc = parsedDrc[key];
                            const hasBenefitExactly = rc.benefit_exactly && rc.benefit_exactly !== 'null' && rc.benefit_exactly.trim() !== '';
                            const hasBenefitDescriptive = rc.benefit_descriptive && rc.benefit_descriptive !== 'null' && rc.benefit_descriptive.trim() !== '';
                            if (hasBenefitExactly || hasBenefitDescriptive) {
                                benefitCount++;
                            }
                        }
                    }
                } catch (e) {
                    console.log(`Failed to parse dynamic_root_causes on row ${rowCount}:`, e.message);
                }
            }

            // 2. Count labs with benefits
            for (const indices of labBenefitIndices) {
                const benefitRaw = indices.benefitIdx !== -1 ? row[indices.benefitIdx] : null;
                const shortDescRaw = indices.shortDescIdx !== -1 ? row[indices.shortDescIdx] : null;

                const hasBenefit = benefitRaw && benefitRaw !== 'NULL' && benefitRaw !== 'null' && benefitRaw.trim() !== '';
                const hasShortDesc = shortDescRaw && shortDescRaw !== 'NULL' && shortDescRaw !== 'null' && shortDescRaw.trim() !== '';

                if (hasBenefit || hasShortDesc) {
                    benefitCount++;
                }
            }

            // Multiply combination by the number of benefits
            let resultCombo = drCombo * benefitCount;

            row.splice(newColIdx, 0, resultCombo);
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
