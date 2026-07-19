require("dotenv").config();
const { sequelize, ResearchResult } = require("./models/all");
const fs = require('fs');
const path = require('path');

// Config & Files
const FULL_ROOTS_FILE = path.join(__dirname, 'Full-Roots.json');
const ITEM_MAPPINGS_FILE = path.join(__dirname, 'item_mappings.json');
const AI_TO_FULL_MAPPINGS_FILE = path.join(__dirname, 'ai_to_full_roots_mappings.json');

// ----------------------------------------------------------------------
// Load Databases & Maps
// ----------------------------------------------------------------------
console.log('Loading Full-Roots.json and local maps...');
const fullRootsData = JSON.parse(fs.readFileSync(FULL_ROOTS_FILE, 'utf8'));
const itemMappings = JSON.parse(fs.readFileSync(ITEM_MAPPINGS_FILE, 'utf8'));
const aiToFullMappings = JSON.parse(fs.readFileSync(AI_TO_FULL_MAPPINGS_FILE, 'utf8'));

// Build Full Roots index for fast exact lookup
const fullRootsIndex = new Map();
for (const item of fullRootsData) {
    if (item.id) {
        const targetId = parseInt(item.id, 10) || 0;
        if (item.Root) fullRootsIndex.set(item.Root.toLowerCase().trim(), targetId);
        if (item.name_en) fullRootsIndex.set(item.name_en.toLowerCase().trim(), targetId);
        if (item['Best MeSH match']) fullRootsIndex.set(item['Best MeSH match'].toLowerCase().trim(), targetId);
    }
}

// Convert itemMappings mapData to a JavaScript Map for easy updates
const itemMap = new Map(Object.entries(itemMappings.mapData || {}));
let nextIndex = itemMappings.nextIndex || 1;

// ----------------------------------------------------------------------
// Similarity Algorithms
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
// Matching Engine
// ----------------------------------------------------------------------
function findTargetId(name) {
    const mapping = aiToFullMappings[name];
    if (mapping && mapping.mapped && mapping.fullRootsRecord && mapping.fullRootsRecord.id) {
        return {
            id: parseInt(mapping.fullRootsRecord.id, 10),
            record: mapping.fullRootsRecord,
            method: 'ai_to_full_roots_mappings.json'
        };
    }
    if (fullRootsIndex.has(name)) {
        const id = fullRootsIndex.get(name);
        const candidate = fullRootsData.find(item => parseInt(item.id, 10) === id);
        return {
            id: id,
            record: {
                id: candidate.id,
                root_ID: candidate.root_ID,
                category_id: candidate.category_id,
                Root: candidate.Root,
                name_en: candidate.name_en,
                scientificName: candidate.Scientific_Name_en || null,
                bestMeshMatch: candidate['Best MeSH match'] || null,
                isRoot: candidate.is_root
            },
            method: 'fullRootsIndex (Exact Match)'
        };
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
            return {
                id: match.id,
                record: match.record,
                method: `Plural Fallback (singular: "${singular}" via ${match.method})`
            };
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
            record: {
                id: bestMatch.id,
                root_ID: bestMatch.root_ID,
                category_id: bestMatch.category_id,
                Root: bestMatch.Root,
                name_en: bestMatch.name_en,
                scientificName: bestMatch.Scientific_Name_en || null,
                bestMeshMatch: bestMatch['Best MeSH match'] || null,
                isRoot: bestMatch.is_root
            },
            method: `Fuzzy Match (matched "${bestMatch.Root}" with ${(highestScore * 100).toFixed(1)}% confidence)`
        };
    }

    return null;
}

// ----------------------------------------------------------------------
// Main Backfill Flow
// ----------------------------------------------------------------------
async function main() {
    try {
        await sequelize.authenticate();
        console.log('✅ Connected to database.');

        // 1. Fetch unique root_name values from database
        const distinctRoots = await sequelize.query(`
            SELECT DISTINCT root_name 
            FROM research_results
            WHERE root_name IS NOT NULL 
              AND root_name != '' 
              AND root_name != 'null' 
              AND root_name != 'None'
        `, { type: sequelize.QueryTypes.SELECT });

        console.log(`🔍 Found ${distinctRoots.length} distinct product names in the database.`);

        let matchCount = 0;
        let updateCount = 0;

        for (const row of distinctRoots) {
            const rawName = row.root_name;
            const cleanName = rawName.toLowerCase().trim();

            const matchResult = matchProduct(cleanName);

            if (matchResult) {
                matchCount++;
                const matchedId = matchResult.id;

                // A. Update the database record
                const [_, rowsAffected] = await sequelize.query(`
                    UPDATE research_results
                    SET "productId" = :matchedId
                    WHERE LOWER(root_name) = :cleanName AND ("productId" IS NULL OR "productId" = 0)
                `, {
                    replacements: { matchedId, cleanName },
                    type: sequelize.QueryTypes.UPDATE
                });

                const affected = parseInt(rowsAffected, 10) || 0;
                if (affected > 0) {
                    updateCount += affected;
                    console.log(`   ⚡ Matched: "${rawName}" -> ID ${matchedId} (${affected} DB rows updated via ${matchResult.method})`);
                }

                // B. Sync item_mappings.json (register if missing)
                let localItemId = itemMap.get(cleanName);
                if (!localItemId) {
                    localItemId = nextIndex++;
                    itemMap.set(cleanName, localItemId);
                    itemMappings.needsSave = true;
                }

                // C. Sync ai_to_full_roots_mappings.json
                if (!aiToFullMappings[cleanName] || !aiToFullMappings[cleanName].mapped) {
                    aiToFullMappings[cleanName] = {
                        extractedName: rawName,
                        productId: localItemId,
                        source: 'item_mappings.json',
                        mapped: true,
                        score: 0.95, // high confidence match
                        matchedField: `Dynamically backfilled via ${matchResult.method}`,
                        fullRootsRecord: matchResult.record
                    };
                    aiToFullMappings.needsSave = true;
                }
            }
        }

        console.log(`\n========================================`);
        console.log(`📊 MATCH & SYNC COMPLETE`);
        console.log(`========================================`);
        console.log(`Total unique names processed: ${distinctRoots.length}`);
        console.log(`Total matched and linked: ${matchCount}`);
        console.log(`Total database rows backfilled: ${updateCount}`);
        console.log(`========================================\n`);

        // Save updated maps if needed
        if (itemMappings.needsSave || itemMap.size !== Object.keys(itemMappings.mapData).length) {
            console.log('💾 Saving updated item_mappings.json...');
            itemMappings.mapData = Object.fromEntries(itemMap);
            itemMappings.nextIndex = nextIndex;
            fs.writeFileSync(ITEM_MAPPINGS_FILE, JSON.stringify(itemMappings, null, 2), 'utf8');
            console.log('   ✅ Saved.');
        }

        if (aiToFullMappings.needsSave) {
            console.log('💾 Saving updated ai_to_full_roots_mappings.json...');
            delete aiToFullMappings.needsSave;
            fs.writeFileSync(AI_TO_FULL_MAPPINGS_FILE, JSON.stringify(aiToFullMappings, null, 2), 'utf8');
            console.log('   ✅ Saved.');
        }

    } catch (err) {
        console.error('❌ Run failed:', err.message);
    } finally {
        await sequelize.close();
        console.log('🔒 DB connection closed.');
    }
}

main();
