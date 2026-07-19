const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// ----------------------------------------------------------------------
// Load Config and Matching Data
// ----------------------------------------------------------------------
const FULL_ROOTS_FILE = path.join(__dirname, 'Full-Roots.json');
const AI_TO_FULL_MAPPINGS_FILE = path.join(__dirname, 'ai_to_full_roots_mappings.json');
const EXCEL_FILE = path.join(__dirname, 'recalculated_new_script_mapping11.xlsx');
const REPORT_FILE = path.join(__dirname, 'unmatched_items_report.txt');

console.log('Loading Full-Roots.json and mappings...');
const fullRootsData = JSON.parse(fs.readFileSync(FULL_ROOTS_FILE, 'utf8'));
const aiToFullMappings = JSON.parse(fs.readFileSync(AI_TO_FULL_MAPPINGS_FILE, 'utf8'));

// Build Full Roots index for fast lookup
const fullRootsIndex = new Map();
for (const item of fullRootsData) {
    if (item.id) {
        const targetId = parseInt(item.id, 10) || 0;
        if (item.Root) fullRootsIndex.set(item.Root.toLowerCase().trim(), targetId);
        if (item.name_en) fullRootsIndex.set(item.name_en.toLowerCase().trim(), targetId);
        if (item['Best MeSH match']) fullRootsIndex.set(item['Best MeSH match'].toLowerCase().trim(), targetId);
    }
}

// ----------------------------------------------------------------------
// Fuzzy Similarity Algorithms from map_ai_roots_to_full.js
// ----------------------------------------------------------------------
function normalizeString(str) {
    if (!str) return "";
    return str.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function calculateSimilarity(s1, s2) {
    if (s1 === s2) return 1;
    const w1 = s1.split(' ').sort().join(' ');
    const w2 = s2.split(' ').sort().join(' ');
    if (w1 === w2) return 1;

    const m = s1.length, n = s2.length;
    if (m === 0 || n === 0) return 0;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(null));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return (Math.max(m, n) - dp[m][n]) / Math.max(m, n);
}

function getBigrams(str) {
    const clean = str.toLowerCase().replace(/\s+/g, '');
    const bigrams = [];
    for (let i = 0; i < clean.length - 1; i++) {
        bigrams.push(clean.substring(i, i + 2));
    }
    return bigrams;
}

function computeDiceCoefficient(s1, s2) {
    const bigrams1 = getBigrams(s1);
    const bigrams2 = getBigrams(s2);
    if (bigrams1.length === 0 && bigrams2.length === 0) return 0;
    let intersection = 0;
    const set2 = new Set(bigrams2);
    for (const b of bigrams1) {
        if (set2.has(b)) intersection++;
    }
    return (2 * intersection) / (bigrams1.length + bigrams2.length);
}

function getMatchScore(extractedName, targetField) {
    const extClean = normalizeString(extractedName);
    const tarClean = normalizeString(targetField);
    if (!extClean || !tarClean) return 0;

    if (extClean === tarClean) return 1.0;
    const levSim = calculateSimilarity(extClean, tarClean);
    const diceSim = computeDiceCoefficient(extClean, tarClean);

    const wordsExt = extClean.split(' ').filter(w => w.length > 0);
    const wordsTar = tarClean.split(' ').filter(w => w.length > 0);

    let matchCount = 0;
    for (const w of wordsExt) {
        if (wordsTar.includes(w)) matchCount++;
    }
    const subsetScore = wordsExt.length > 0 ? matchCount / Math.min(wordsExt.length, wordsTar.length) : 0;
    const jaccardScore = (wordsExt.length + wordsTar.length - matchCount) > 0 ?
        matchCount / (wordsExt.length + wordsTar.length - matchCount) : 0;

    const isSub = (extClean.length >= 4 && tarClean.includes(extClean)) ||
                  (tarClean.length >= 4 && extClean.includes(tarClean));

    let composite = (levSim * 0.40) + (diceSim * 0.30) + (jaccardScore * 0.20) + (subsetScore * 0.10);
    if (isSub) {
        composite = Math.max(composite, 0.78) + 0.12;
    }
    return Math.min(composite, 0.99);
}

// ----------------------------------------------------------------------
// Matching Helper
// ----------------------------------------------------------------------
function findTargetId(name) {
    const mapping = aiToFullMappings[name];
    if (mapping && mapping.mapped && mapping.fullRootsRecord && mapping.fullRootsRecord.id) {
        return { id: parseInt(mapping.fullRootsRecord.id, 10), method: 'ai_to_full_roots_mappings.json' };
    }
    if (fullRootsIndex.has(name)) {
        return { id: fullRootsIndex.get(name), method: 'fullRootsIndex (Exact Match)' };
    }
    return null;
}

function matchProduct(name) {
    const cleanItemName = name.toLowerCase().trim();
    
    // 1. Try direct lookup
    let match = findTargetId(cleanItemName);
    if (match) return match;

    // 2. Try plural fallback (singularization)
    let singular = cleanItemName;
    if (cleanItemName.endsWith('ies')) {
        singular = cleanItemName.slice(0, -3) + 'y';
    } else if (cleanItemName.endsWith('es')) {
        const test1 = cleanItemName.slice(0, -2);
        const test2 = cleanItemName.slice(0, -1);
        if (findTargetId(test1)) singular = test1;
        else if (findTargetId(test2)) singular = test2;
    } else if (cleanItemName.endsWith('s') && !cleanItemName.endsWith('ss')) {
        singular = cleanItemName.slice(0, -1);
    }

    if (singular !== cleanItemName) {
        match = findTargetId(singular);
        if (match) {
            return { id: match.id, method: `Plural Fallback (singular: "${singular}" via ${match.method})` };
        }
    }

    // 3. Try fuzzy matching against all Full-Roots.json candidates
    let bestMatch = null;
    let highestScore = 0;
    const MATCH_THRESHOLD = 0.65;

    for (const candidate of fullRootsData) {
        const rootName = candidate.Root || '';
        const nameEn = candidate.name_en || '';
        const meshMatch = candidate['Best MeSH match'] || '';

        const scoreRoot = getMatchScore(cleanItemName, rootName);
        const scoreNameEn = getMatchScore(cleanItemName, nameEn);
        const scoreMesh = getMatchScore(cleanItemName, meshMatch);

        const maxScore = Math.max(scoreRoot, scoreNameEn, scoreMesh);
        if (maxScore > highestScore) {
            highestScore = maxScore;
            bestMatch = candidate;
        }
    }

    if (highestScore >= MATCH_THRESHOLD && bestMatch) {
        return {
            id: parseInt(bestMatch.root_ID || bestMatch.id, 10),
            method: `Fuzzy Match (matched "${bestMatch.Root}" with ${(highestScore * 100).toFixed(1)}% confidence)`
        };
    }

    return null;
}

// ----------------------------------------------------------------------
// Load Excel and Scan
// ----------------------------------------------------------------------
console.log(`Reading Excel file: ${EXCEL_FILE}`);
if (!fs.existsSync(EXCEL_FILE)) {
    console.error(`Error: File not found at ${EXCEL_FILE}`);
    process.exit(1);
}

const workbook = XLSX.readFile(EXCEL_FILE);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(sheet);

console.log(`Successfully loaded ${rows.length} rows from Excel.`);

const unmatchedUniqueProducts = new Map(); // name -> occurrences
const matchedUniqueProducts = new Map(); // name -> matched info

for (const row of rows) {
    const pid = row.productId;
    // Extract product name from any of the standard column names
    const productName = String(row.root_name || row.product || row.item || row.Root || '').trim();

    if (!productName) continue;

    const isUnmapped = !pid || pid === 0 || pid === '0' || pid === 'NULL' || pid === '';

    if (isUnmapped) {
        unmatchedUniqueProducts.set(productName.toLowerCase(), (unmatchedUniqueProducts.get(productName.toLowerCase()) || 0) + 1);
    } else {
        matchedUniqueProducts.set(productName.toLowerCase(), pid);
    }
}

console.log(`Found ${unmatchedUniqueProducts.size} unique unmapped product names.`);

// Analyze each unmapped product name
const reportLines = [];
reportLines.push(`======================================================================`);
reportLines.push(`              UNMAPPED PRODUCTS ANALYSIS REPORT`);
reportLines.push(`            File: recalculated_new_script_mapping11.xlsx`);
reportLines.push(`======================================================================\n`);
reportLines.push(`Total Unique Unmapped Names: ${unmatchedUniqueProducts.size}\n`);

let matchesFound = 0;
let genericDrugs = 0;

for (const [name, count] of unmatchedUniqueProducts.entries()) {
    const matchResult = matchProduct(name);
    if (matchResult) {
        matchesFound++;
        reportLines.push(`[RESOLVABLE] "${name}" (found ${count} times)`);
        reportLines.push(`   -> Suggested Product ID: ${matchResult.id}`);
        reportLines.push(`   -> Method: ${matchResult.method}`);
        reportLines.push(`----------------------------------------------------------------------`);
    } else {
        genericDrugs++;
        reportLines.push(`[UNMATCHABLE] "${name}" (found ${count} times)`);
        reportLines.push(`   -> No match found in Full-Roots.json (probably generic drug/chemical/placebo)`);
        reportLines.push(`----------------------------------------------------------------------`);
    }
}

reportLines.push(`\n======================================================================`);
reportLines.push(`SUMMARY:`);
reportLines.push(`- Total Resolvable (Should take an ID): ${matchesFound}`);
reportLines.push(`- Total Generic/Unmatchable (Should remain 0/NULL): ${genericDrugs}`);
reportLines.push(`======================================================================`);

fs.writeFileSync(REPORT_FILE, reportLines.join('\n'), 'utf8');
console.log(`\nReport successfully written to: ${REPORT_FILE}`);
console.log(`Run 'cat unmatched_items_report.txt' or open it to view the results.`);
