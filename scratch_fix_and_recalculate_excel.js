const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// File Paths
const INPUT_FILE = path.join(__dirname, 'new_script_mapping11.xlsx');
const OUTPUT_FILE = path.join(__dirname, 'recalculated_new_script_mapping11.xlsx');
const FULL_ROOTS_FILE = path.join(__dirname, 'Full-Roots.json');
const AI_TO_FULL_MAPPINGS_FILE = path.join(__dirname, 'ai_to_full_roots_mappings.json');

console.log('🚀 Loading Full-Roots.json and mappings...');
const fullRootsData = JSON.parse(fs.readFileSync(FULL_ROOTS_FILE, 'utf8'));
const aiToFullMappings = JSON.parse(fs.readFileSync(AI_TO_FULL_MAPPINGS_FILE, 'utf8'));

// Build Full Roots index for fast exact lookup and ID-to-RootName map
const fullRootsIndex = new Map();
const idToRootNameMap = new Map();
for (const item of fullRootsData) {
    if (item.id) {
        const targetId = parseInt(item.id, 10) || 0;
        if (targetId > 0 && item.Root) {
            idToRootNameMap.set(targetId, item.Root);
        }
        if (item.Root) fullRootsIndex.set(item.Root.toLowerCase().trim(), item);
        if (item.name_en) fullRootsIndex.set(item.name_en.toLowerCase().trim(), item);
        if (item['Best MeSH match']) fullRootsIndex.set(item['Best MeSH match'].toLowerCase().trim(), item);
    }
}

// ----------------------------------------------------------------------
// Fuzzy Similarity Algorithms
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
function findTargetRootInfo(name) {
    const mapping = aiToFullMappings[name];
    if (mapping && mapping.mapped && mapping.fullRootsRecord && mapping.fullRootsRecord.id) {
        return {
            id: parseInt(mapping.fullRootsRecord.id, 10),
            root: mapping.fullRootsRecord.Root || ''
        };
    }
    if (fullRootsIndex.has(name)) {
        const item = fullRootsIndex.get(name);
        return {
            id: parseInt(item.id, 10) || 0,
            root: item.Root || ''
        };
    }
    return null;
}

function matchProduct(name) {
    const cleanItemName = name.toLowerCase().trim();
    
    // 1. Try direct lookup
    let info = findTargetRootInfo(cleanItemName);
    if (info && info.id > 0) return info;

    // 2. Try plural fallback (singularization)
    let singular = cleanItemName;
    if (cleanItemName.endsWith('ies')) {
        singular = cleanItemName.slice(0, -3) + 'y';
    } else if (cleanItemName.endsWith('es')) {
        const test1 = cleanItemName.slice(0, -2);
        const test2 = cleanItemName.slice(0, -1);
        if (findTargetRootInfo(test1)) singular = test1;
        else if (findTargetRootInfo(test2)) singular = test2;
    } else if (cleanItemName.endsWith('s') && !cleanItemName.endsWith('ss')) {
        singular = cleanItemName.slice(0, -1);
    }

    if (singular !== cleanItemName) {
        info = findTargetRootInfo(singular);
        if (info && info.id > 0) return info;
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
            root: bestMatch.Root || ''
        };
    }

    return { id: 0, root: '' };
}

// ----------------------------------------------------------------------
// Load Excel
// ----------------------------------------------------------------------
console.log(`\nReading Excel file: ${INPUT_FILE}`);
if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Error: File not found at ${INPUT_FILE}`);
    process.exit(1);
}

const workbook = XLSX.readFile(INPUT_FILE);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

// Get original headers order
const headers = [];
const range = XLSX.utils.decode_range(sheet['!ref']);
for (let C = range.s.c; C <= range.e.c; ++C) {
    const addr = XLSX.utils.encode_cell({ r: range.s.r, c: C });
    const cell = sheet[addr];
    if (cell && cell.v !== undefined) {
        headers.push(String(cell.v).trim());
    }
}

// Insert root_origin_name after root_name in the headers array
const rootNameIndex = headers.indexOf('root_name');
if (rootNameIndex !== -1) {
    if (!headers.includes('root_origin_name')) {
        headers.splice(rootNameIndex + 1, 0, 'root_origin_name');
    }
} else {
    if (!headers.includes('root_origin_name')) {
        headers.push('root_origin_name');
    }
}

const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
console.log(`Loaded ${rows.length} rows.`);

// ----------------------------------------------------------------------
// Phase 1: Fix Product IDs in place and populate root_origin_name
// ----------------------------------------------------------------------
console.log('\n🔍 Phase 1: Resolving and fixing product IDs, populating root_origin_name...');
let resolvedCount = 0;
const resolvedLogs = [];

for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const pid = row.productId;
    const isUnmapped = !pid || pid === 0 || pid === '0' || pid === 'NULL' || pid === '';

    if (isUnmapped) {
        const productName = String(row.root_name || row.product || row.item || row.Root || '').trim();
        if (productName) {
            const matchResult = matchProduct(productName);
            if (matchResult && matchResult.id > 0) {
                row.productId = matchResult.id;
                row.root_origin_name = matchResult.root;
                resolvedCount++;
                if (resolvedLogs.length < 20) {
                    resolvedLogs.push(`   -> Row ${i + 2}: "${productName}" mapped to Product ID ${matchResult.id} (origin: "${matchResult.root}")`);
                }
            } else {
                row.productId = 0; // standard fallback
                row.root_origin_name = '';
            }
        } else {
            row.productId = 0;
            row.root_origin_name = '';
        }
    } else {
        // Ensure it's a number
        const idNum = parseInt(pid, 10) || 0;
        row.productId = idNum;
        row.root_origin_name = idToRootNameMap.get(idNum) || '';
    }
}

console.log(`✅ Fixed and matched ${resolvedCount} rows to their correct product IDs.`);
if (resolvedLogs.length > 0) {
    console.log('Sample matches resolved:');
    resolvedLogs.forEach(log => console.log(log));
    if (resolvedCount > 20) console.log(`   ... and ${resolvedCount - 20} more.`);
}

// ----------------------------------------------------------------------
// Phase 2: Recalculate DW (from recalculate_xlsx_dw.js)
// ----------------------------------------------------------------------
console.log('\n📊 Phase 2: Recalculating DW, category, and sorting rows...');

// Group rows by productId and diseaseId
const groupMap = new Map();
for (const row of rows) {
    const pid = row.productId;
    const did = row.diseaseId;

    if (!pid || pid === 0) {
        continue; // skip unmatchables in recalculation
    }

    const groupKey = `${pid}_${did}`;
    if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, []);
    }
    groupMap.get(groupKey).push(row);
}

console.log(`Grouped into ${groupMap.size} product-disease pairs.`);
let dwUpdatesCount = 0;

for (const [groupKey, groupRows] of groupMap.entries()) {
    const uniqueArticlesMap = new Map();

    for (const row of groupRows) {
        const pmid = row.PMID;
        const pubmed = row.pubmed;
        const title = row.title;
        const rowId = row.id;

        const articleKey = String(pmid || pubmed || title || rowId).trim();

        const rawRate = row.disease_rate_combination;
        let rateVal = parseFloat(rawRate);
        if (isNaN(rateVal)) {
            rateVal = 0;
        }

        if (!uniqueArticlesMap.has(articleKey)) {
            uniqueArticlesMap.set(articleKey, {
                key: articleKey,
                rate: rateVal,
                rows: []
            });
        }
        uniqueArticlesMap.get(articleKey).rows.push(row);
    }

    const uniqueArticles = Array.from(uniqueArticlesMap.values());
    const articles_count = uniqueArticles.length;
    const category = articles_count <= 173 ? "ready" : "not_ready";

    // Calculate DW using combination rate
    const rates = uniqueArticles.map(a => a.rate || 0);
    let calculated_dw = 0;
    if (rates.length > 0) {
        const sum = rates.reduce((a, b) => a + b, 0);
        const max = Math.max(...rates);
        calculated_dw = sum * max;
    }

    // Sort unique articles descending by rate to determine new article_number
    uniqueArticles.sort((a, b) => b.rate - a.rate);

    for (let j = 0; j < uniqueArticles.length; j++) {
        const articleGroup = uniqueArticles[j];
        const newArticleNumber = String(j + 1);

        for (const r of articleGroup.rows) {
            r.calculated_dw = calculated_dw;
            if ('article_number' in r) r.article_number = newArticleNumber;
            if ('articles_count' in r) r.articles_count = articles_count;
            if ('category' in r) r.category = category;
            dwUpdatesCount++;
        }
    }
}

console.log(`✅ Recalculated DW and updated columns on ${dwUpdatesCount} row instances.`);

// ----------------------------------------------------------------------
// Save Excel
// ----------------------------------------------------------------------
console.log(`\n💾 Writing results to: ${OUTPUT_FILE}`);
const newSheet = XLSX.utils.json_to_sheet(rows, { header: headers });
const newWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(newWorkbook, newSheet, sheetName);

XLSX.writeFile(newWorkbook, OUTPUT_FILE);
console.log(`✨ Process complete! Saved successfully to ${OUTPUT_FILE}`);
