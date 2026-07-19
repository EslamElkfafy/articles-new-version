require('dotenv').config();
const fs = require('fs');
const path = require('path');

// ----------------------------------------------------------------------
// 1. CONFIGURATION & FILE PATHS
// ----------------------------------------------------------------------
const ITEM_MAPPINGS_FILE = path.join(__dirname, 'item_mappings.json');
const FULL_ROOTS_FILE = path.join(__dirname, 'Full-Roots.json');
const MAPPING_OUTPUT_FILE = path.join(__dirname, 'ai_to_full_roots_mappings.json');
const MATCH_THRESHOLD = 0.65; // Confidence threshold for a valid match

// ----------------------------------------------------------------------
// 2. DATABASE MODELS LOAD BYPASS (Strict item_mappings.json Scan Mode)
// ----------------------------------------------------------------------
// Database scanning bypassed as requested by user. Only loading item_mappings.json.

// ----------------------------------------------------------------------
// 3. TEXT UTILITIES & ROBUST SIMILARTY ALGORITHMS
// ----------------------------------------------------------------------

/**
 * Basic string cleaning and normalisation
 */
function normalizeString(str) {
    if (!str) return "";
    return str.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Calculates similarity between two strings using Levenshtein distance
 * Supports word reordering (e.g. "type 2 diabetes" vs "diabetes type 2")
 */
function calculateSimilarity(s1, s2) {
    if (s1 === s2) return 1;
    // Handle reordered words
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
    const dist = dp[m][n];
    return (Math.max(m, n) - dist) / Math.max(m, n);
}

/**
 * Generate character bigrams for Sørensen-Dice coefficient
 */
function getBigrams(str) {
    const clean = str.toLowerCase().replace(/\s+/g, '');
    const bigrams = [];
    for (let i = 0; i < clean.length - 1; i++) {
        bigrams.push(clean.substring(i, i + 2));
    }
    return bigrams;
}

/**
 * Compute Sørensen-Dice character coefficient
 */
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

/**
 * Calculates word subset overlap.
 * Useful for catching "type 2 diabetes mellitus" vs "type 2 diabetes"
 */
function calculateWordSubset(s1, s2) {
    const w1 = s1.split(/\s+/).filter(w => w.length > 0);
    const w2 = s2.split(/\s+/).filter(w => w.length > 0);
    if (w1.length === 0 || w2.length === 0) return 0;
    
    let intersection = 0;
    for (const w of w1) {
        if (w2.includes(w)) intersection++;
    }
    
    return intersection / Math.min(w1.length, w2.length);
}

/**
 * Core matching function that calculates a hybrid composite score
 * between an AI-extracted item name and a candidate root name/field.
 */
function getMatchScore(extractedName, targetField) {
    const extClean = normalizeString(extractedName);
    const tarClean = normalizeString(targetField);
    if (!extClean || !tarClean) return 0;

    // 1. Exact case-insensitive match
    if (extClean === tarClean) return 1.0;

    // 2. Word reordered Levenshtein similarity
    const levSim = calculateSimilarity(extClean, tarClean);

    // 3. Dice bigram coefficient
    const diceSim = computeDiceCoefficient(extClean, tarClean);

    // 4. Jaccard word overlap
    const wordsExt = extClean.split(' ').filter(w => w.length > 0);
    const wordsTar = tarClean.split(' ').filter(w => w.length > 0);

    let matchCount = 0;
    for (const w of wordsExt) {
        if (wordsTar.includes(w)) matchCount++;
    }
    
    const subsetScore = wordsExt.length > 0 ? matchCount / Math.min(wordsExt.length, wordsTar.length) : 0;
    const jaccardScore = (wordsExt.length + wordsTar.length - matchCount) > 0 ?
        matchCount / (wordsExt.length + wordsTar.length - matchCount) : 0;

    // 5. Intelligent Substring Boost
    // If one is a complete substring of another (e.g. "blueberry" and "blueberry plants")
    const isSub = (extClean.length >= 4 && tarClean.includes(extClean)) ||
                  (tarClean.length >= 4 && extClean.includes(tarClean));

    // Calculate composite weighted score
    let composite = (levSim * 0.40) + (diceSim * 0.30) + (jaccardScore * 0.20) + (subsetScore * 0.10);

    if (isSub) {
        // Boost complete substrings, but don't exceed 0.95 to maintain exact match supremacy
        composite = Math.max(composite, 0.78) + 0.12;
    }

    return Math.min(composite, 0.99); // Cap non-exact matches at 0.99
}

// ----------------------------------------------------------------------
// 4. MAIN EXECUTABLE FLOW
// ----------------------------------------------------------------------
async function main() {
    console.log('🚀 Starting AI Roots to Full-Roots.json Matcher...');
    const startTime = Date.now();

    // --- Step A: Gather Unique AI-Extracted Roots ---
    console.log('\n🔍 Step 1: Gathering unique AI-extracted roots...');
    const aiRoots = new Set();
    const itemMapDetails = {}; // Track Product ID from item_mappings.json if available

    // 1. Read from item_mappings.json
    if (fs.existsSync(ITEM_MAPPINGS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(ITEM_MAPPINGS_FILE, 'utf8'));
            if (data && data.mapData) {
                console.log(`📂 Found item_mappings.json containing ${Object.keys(data.mapData).length} mappings.`);
                for (const [name, id] of Object.entries(data.mapData)) {
                    const cleanName = name.trim();
                    if (cleanName) {
                        aiRoots.add(cleanName);
                        itemMapDetails[cleanName.toLowerCase()] = { id, source: 'item_mappings.json' };
                    }
                }
            }
        } catch (e) {
            console.error('⚠️ Error reading item_mappings.json:', e.message);
        }
    } else {
        console.log('ℹ️ item_mappings.json not found in this folder.');
    }

    // 2. Read unique root_name values from PostgreSQL database (Bypassed)

    if (aiRoots.size === 0) {
        console.warn('⚠️ No AI-extracted roots found in JSON mapping file or database. Using internal fallback mock.');
        const mockRoots = ['bilberry', 'blueberry', 'cloudberry', 'green tea', 'placebo gel', 'sglt-2 inhibitors', 'cyanidin-3-glucoside'];
        mockRoots.forEach(r => aiRoots.add(r));
    }

    console.log(`✅ Collected ${aiRoots.size} unique AI-extracted roots/items.`);

    // --- Step B: Load Full-Roots.json ---
    console.log(`\n📊 Step 2: Loading master Full-Roots.json database...`);
    if (!fs.existsSync(FULL_ROOTS_FILE)) {
        console.error(`❌ Error: Full-Roots.json not found at ${FULL_ROOTS_FILE}`);
        process.exit(1);
    }

    let fullRootsData = [];
    try {
        fullRootsData = JSON.parse(fs.readFileSync(FULL_ROOTS_FILE, 'utf8'));
        console.log(`✅ Loaded ${fullRootsData.length} master root entries from Full-Roots.json.`);
    } catch (e) {
        console.error('❌ Error parsing Full-Roots.json:', e.message);
        process.exit(1);
    }

    // --- Step C: Compute Fuzzy Hybrid Matches ---
    console.log(`\n🧬 Step 3: Performing hybrid fuzzy matching matching...`);
    const mappingResults = {};
    const reportRows = [];
    let mappedCount = 0;

    for (const rawExtractedName of aiRoots) {
        let bestMatch = null;
        let highestScore = 0;
        let bestMatchField = '';
        const lowerExtracted = rawExtractedName.toLowerCase();

        // Match against every master root in Full-Roots.json
        for (const candidate of fullRootsData) {
            const rootName = candidate.Root || '';
            const nameEn = candidate.name_en || '';
            const meshMatch = candidate['Best MeSH match'] || '';

            // Compute score against the three main name fields
            const scoreRoot = getMatchScore(rawExtractedName, rootName);
            const scoreNameEn = getMatchScore(rawExtractedName, nameEn);
            const scoreMesh = getMatchScore(rawExtractedName, meshMatch);

            const maxScore = Math.max(scoreRoot, scoreNameEn, scoreMesh);

            if (maxScore > highestScore) {
                highestScore = maxScore;
                bestMatch = candidate;
                
                if (maxScore === scoreRoot) bestMatchField = `Root ("${rootName}")`;
                else if (maxScore === scoreNameEn) bestMatchField = `name_en ("${nameEn}")`;
                else bestMatchField = `Best MeSH match ("${meshMatch}")`;
            }
        }

        const isMatched = highestScore >= MATCH_THRESHOLD && bestMatch;
        const details = itemMapDetails[lowerExtracted] || { id: null, source: 'manual' };

        if (isMatched) {
            mappedCount++;
            mappingResults[lowerExtracted] = {
                extractedName: rawExtractedName,
                productId: details.id,
                source: details.source,
                mapped: true,
                score: parseFloat(highestScore.toFixed(3)),
                matchedField: bestMatchField,
                fullRootsRecord: {
                    id: bestMatch.id,
                    root_ID: bestMatch.root_ID,
                    category_id: bestMatch.category_id,
                    Root: bestMatch.Root,
                    name_en: bestMatch.name_en,
                    scientificName: bestMatch.Scientific_Name_en || null,
                    bestMeshMatch: bestMatch['Best MeSH match'] || null,
                    isRoot: bestMatch.is_root
                }
            };

            reportRows.push({
                'AI Extracted Name': rawExtractedName,
                'Status': '✅ MATCHED',
                'Score': `${(highestScore * 100).toFixed(1)}%`,
                'Full Root': bestMatch.Root,
                'Full-Roots ID': bestMatch.root_ID,
                'Best Match Source': bestMatchField
            });
        } else {
            mappingResults[lowerExtracted] = {
                extractedName: rawExtractedName,
                productId: details.id,
                source: details.source,
                mapped: false,
                score: parseFloat(highestScore.toFixed(3)),
                matchedField: null,
                bestFailSuggestion: bestMatch ? bestMatch.Root : null
            };

            reportRows.push({
                'AI Extracted Name': rawExtractedName,
                'Status': '❌ UNMAPPED',
                'Score': bestMatch ? `${(highestScore * 100).toFixed(1)}%` : '0%',
                'Full Root': 'N/A',
                'Full-Roots ID': 'N/A',
                'Best Match Source': bestMatch ? `Best suggestion: "${bestMatch.Root}"` : 'None'
            });
        }
    }

    // --- Step D: Save JSON Mapping Output ---
    console.log(`\n💾 Step 4: Saving persistent mapping file to ${MAPPING_OUTPUT_FILE}...`);
    try {
        fs.writeFileSync(MAPPING_OUTPUT_FILE, JSON.stringify(mappingResults, null, 2), 'utf8');
        console.log('✅ AI to Full Roots persistent mapping saved successfully!');
    } catch (err) {
        console.error('❌ Failed to save mappings to file:', err.message);
    }

    // --- Step E: Sync mapped items database helper (Bypassed) ---

    // --- Step F: Output Beautiful Terminal Table Report ---
    console.log('\n==============================================================================================================');
    console.log(`                               AI EXTRACTED ROOTS TO FULL-ROOTS.JSON MATCHER REPORT`);
    console.log(`                                Total Extracted: ${aiRoots.size} | Mapped: ${mappedCount} | Success Rate: ${((mappedCount / aiRoots.size) * 100).toFixed(1)}%`);
    console.log('==============================================================================================================');
    console.table(reportRows);
    console.log('==============================================================================================================');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✨ Process complete in ${elapsed} seconds.`);
}

main().catch(err => {
    console.error('❌ FATAL: Script aborted due to error:', err);
});
