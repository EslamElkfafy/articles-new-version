// Load environment variables from .env file
require("dotenv").config();
const XLSX = require('xlsx');

// Import required libraries and modules
const axios = require("axios"); // For making HTTP requests
const fs = require("fs");
const path = require("path");
const util = require("util");

const logFile = fs.createWriteStream(path.join(__dirname, 'process_logs.txt'), { flags: 'a' });
const originalLog = console.log;
const originalError = console.error;

console.log = function () {
    const msg = util.format.apply(null, arguments);
    logFile.write(`[${new Date().toISOString()}] INFO: ` + msg + '\n');
    originalLog.apply(console, arguments);
};

console.error = function () {
    const msg = util.format.apply(null, arguments);
    logFile.write(`[${new Date().toISOString()}] ERROR: ` + msg + '\n');
    originalError.apply(console, arguments);
};
const { Item, Disease, ResearchResult, sequelize } = require("./models/all"); // Database models
const { summarizeText, preFetchBatchArticles, summarizePreFetchedContent } = require("./getContent"); // Custom module for text processing

/**
 * Calculates similarity between two strings using Levenshtein distance
 * Supports word reordering (e.g. "type 2 diabetes" vs "diabetes type 2")
 * @returns {number} - Similarity score between 0 and 1
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
 * Robustly extracts and parses a JSON array from AI output
 * @param {string} text - Raw AI output text
 * @returns {Array|null} - Parsed JSON array or null if failed
 */
function extractJSONArray(text) {
    if (!text) return null;

    // If the AI library already parsed the JSON into an object/array, return it directly
    if (typeof text !== 'string') {
        if (Array.isArray(text)) return text;
        if (typeof text === 'object') return [text]; // Wrap single objects in an array
        text = String(text);
    }

    // 1. Try to find content within markdown JSON blocks if present
    const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    let content = markdownMatch ? markdownMatch[1] : text;

    // 2. Try to find the first [ 
    const firstBracket = content.indexOf('[');
    if (firstBracket === -1) {
        return null;
    }

    // 3. We cut everything before the first [
    content = content.substring(firstBracket);

    // 4. Advanced JSON Repair for Unescaped Newlines and Truncation
    let inString = false;
    let isEscaped = false;
    let result = "";
    let openBrackets = 0;
    let openBraces = 0;

    for (let i = 0; i < content.length; i++) {
        const char = content[i];

        if (char === '\\') {
            isEscaped = !isEscaped;
            result += char;
        } else if (char === '"' && !isEscaped) {
            inString = !inString;
            result += char;
        } else if (inString) {
            // Fix unescaped control characters inside strings
            if (char === '\n') result += '\\n';
            else if (char === '\r') result += '\\r';
            else if (char === '\t') result += '\\t';
            else result += char;
            isEscaped = false;
        } else {
            // Track open braces/brackets outside strings
            if (char === '[') openBrackets++;
            else if (char === ']') openBrackets = Math.max(0, openBrackets - 1);
            else if (char === '{') openBraces++;
            else if (char === '}') openBraces = Math.max(0, openBraces - 1);

            result += char;
            isEscaped = false;
        }

        // If we found the matching closing bracket for the main array, we can stop parsing!
        if (!inString && openBrackets === 0 && openBraces === 0 && i > 0) {
            break;
        }
    }

    // 5. Auto-close truncated JSON
    if (inString) {
        result += '"'; // Close unterminated string
    }

    // Close objects
    while (openBraces > 0) {
        result += '}';
        openBraces--;
    }

    // Close arrays
    while (openBrackets > 0) {
        result += ']';
        openBrackets--;
    }

    // 6. Fix any dangling trailing commas before closures
    result = result.replace(/,\s*\]/g, ']').replace(/,\s*\}/g, '}');

    try {
        const parsed = JSON.parse(result);
        return parsed;
    } catch (e) {
        console.log("    ❌ JSON Parse Error Details:", e.message);
        return null;
    }
}

/**
 * Main function that orchestrates the research processing for a batch of results
 * @param {Object|Array} resultsData - The result object or array of result objects from process-all-diseases
 */
async function getURL(resultsData) {
    // If resultsData is a single object (from one product-disease pair), wrap it in an array
    const results = Array.isArray(resultsData) ? resultsData : [resultsData];
    let count = 1;

    // Scoped root cause maps per disease to ensure column consistency
    // Format: { 'disease_name': { map: Map('root cause' -> index), nextIndex: 1 } }
    const MAPPINGS_FILE = path.join(__dirname, 'root_cause_mappings.json');
    if (!global.scopedRootCauseMaps) {
        global.scopedRootCauseMaps = {};
        global.globalNextIndex = 1;
        if (fs.existsSync(MAPPINGS_FILE)) {
            try {
                const rawData = JSON.parse(fs.readFileSync(MAPPINGS_FILE, 'utf8'));
                for (const [disease, scopes] of Object.entries(rawData || {})) {
                    const map = new Map(Object.entries(scopes?.mapData || {}));
                    global.scopedRootCauseMaps[disease] = { map: map, nextIndex: scopes?.nextIndex || 1, needsSave: false };
                    if (scopes?.nextIndex > global.globalNextIndex) {
                        global.globalNextIndex = scopes.nextIndex;
                    }
                }
            } catch (e) { console.error("⚠️ Error loading root_cause_mappings.json:", e); }
        }
    }

    // Global item mappings for dynamic unsupervised extraction
    const ITEM_MAPPINGS_FILE = path.join(__dirname, 'item_mappings.json');
    if (!global.itemMappings) {
        global.itemMappings = { map: new Map(), nextIndex: 1, needsSave: false };
        if (fs.existsSync(ITEM_MAPPINGS_FILE)) {
            try {
                const rawData = JSON.parse(fs.readFileSync(ITEM_MAPPINGS_FILE, 'utf8'));
                global.itemMappings.map = new Map(Object.entries(rawData?.mapData || {}));
                global.itemMappings.nextIndex = rawData?.nextIndex || 1;
            } catch (e) { console.error("⚠️ Error loading item_mappings.json:", e); }
        }
    }

    // AI to Full-Roots mapping table
    const AI_TO_FULL_MAPPINGS_FILE = path.join(__dirname, 'ai_to_full_roots_mappings.json');
    if (!global.aiToFullMappings) {
        global.aiToFullMappings = {};
        if (fs.existsSync(AI_TO_FULL_MAPPINGS_FILE)) {
            try {
                global.aiToFullMappings = JSON.parse(fs.readFileSync(AI_TO_FULL_MAPPINGS_FILE, 'utf8'));
            } catch (e) { console.error("⚠️ Error loading ai_to_full_roots_mappings.json:", e); }
        }
    }

    // Master Full-Roots mapping index
    const FULL_ROOTS_FILE = path.join(__dirname, 'Full-Roots.json');
    if (!global.fullRootsIndex) {
        global.fullRootsIndex = new Map();
        if (fs.existsSync(FULL_ROOTS_FILE)) {
            try {
                const data = JSON.parse(fs.readFileSync(FULL_ROOTS_FILE, 'utf8'));
                for (const item of data) {
                    if (item.id) {
                        const targetId = parseInt(item.id, 10) || 0;
                        if (item.Root) global.fullRootsIndex.set(item.Root.toLowerCase().trim(), targetId);
                        if (item.name_en) global.fullRootsIndex.set(item.name_en.toLowerCase().trim(), targetId);
                        if (item['Best MeSH match']) global.fullRootsIndex.set(item['Best MeSH match'].toLowerCase().trim(), targetId);
                    }
                }
            } catch (e) { console.error("⚠️ Error loading Full-Roots.json:", e); }
        }
    }

    // Global disease mappings for dynamic unsupervised disease extraction
    const DISEASE_MAPPINGS_FILE = path.join(__dirname, 'disease_mappings.json');
    if (!global.diseaseMappings) {
        global.diseaseMappings = { map: new Map(), nextIndex: 1, needsSave: false };
        if (fs.existsSync(DISEASE_MAPPINGS_FILE)) {
            try {
                const rawData = JSON.parse(fs.readFileSync(DISEASE_MAPPINGS_FILE, 'utf8'));
                global.diseaseMappings.map = new Map(Object.entries(rawData?.mapData || {}));
                global.diseaseMappings.nextIndex = rawData?.nextIndex || 1;
            } catch (e) { console.error("⚠️ Error loading disease_mappings.json:", e); }
        }
    }

    // ICD-11 specific mappings for code, foundation URL, and title backfill
    const ICD11_MAPPINGS_FILE = path.join(__dirname, 'icd11_disease_mappings.json');
    if (!global.icd11DiseaseMappings) {
        global.icd11DiseaseMappings = {};
        if (fs.existsSync(ICD11_MAPPINGS_FILE)) {
            try {
                global.icd11DiseaseMappings = JSON.parse(fs.readFileSync(ICD11_MAPPINGS_FILE, 'utf8'));
            } catch (e) { console.error("⚠️ Error loading icd11_disease_mappings.json:", e); }
        }
    }
    if (!global.consecutiveAIFailures) {
        global.consecutiveAIFailures = 0;
    }

    const allTasks = [];
    let totalItems = 0;
    const diseaseNameSample = results.length > 0 ? results[0].disease_name : "Unknown Disease";
    const uniqueDiseaseIds = new Set();

    for (const resultObj of results) {
        const articles = resultObj.articles || [];
        if (articles.length === 0) continue;
        totalItems++;

        for (const article of articles) {
            allTasks.push({ resultObj, article });
        }
    }

    if (allTasks.length === 0) return;

    console.log(`🔍 Processing ${allTasks.length} total articles across ${totalItems} items for disease ${diseaseNameSample}...`);

    const CONCURRENCY_LIMIT = 100;

    for (let i = 0; i < allTasks.length; i += CONCURRENCY_LIMIT) {
        const batchTasks = allTasks.slice(i, i + CONCURRENCY_LIMIT);
        let recordsToInsert = [];

        // PRE-FETCH entire batch at once (only for ready articles)
        const readyArticles = batchTasks.filter(t => !(t.resultObj.category === "not_ready" || (t.resultObj.articles || []).length > 173)).map(t => t.article);

        let preFetchedData = {};
        if (readyArticles.length > 0) {
            preFetchedData = await preFetchBatchArticles(readyArticles);
        }

        const batchPromises = batchTasks.map(async (task) => {
            const { resultObj, article } = task;
            const currentCount = count++;
            console.log(`[${currentCount}] Processing article: ${article.title} for ${resultObj.root_name}`);

            const diseaseName = resultObj.disease_name;
            if (!global.scopedRootCauseMaps[diseaseName]) {
                global.scopedRootCauseMaps[diseaseName] = { map: new Map(), nextIndex: global.globalNextIndex };
            }
            const rcScope = global.scopedRootCauseMaps[diseaseName];

            const isNotReady = resultObj.category === "not_ready" || (resultObj.articles || []).length > 173;

            try {
                let data = [];
                const articleDbResults = [];

                if (isNotReady) {
                    console.log(`    [Article ${currentCount}] Category is not_ready or DW > threshold. Skipping AI analysis and saving basic article info.`);
                    data = [{}]; // Create an empty record to insert article info into DB with null AI fields
                } else {
                    // Get summarized text for this article
                    const needsRateExtraction = article.rate === 0;

                    let databefore = null;
                    const pmid = article.PMID;

                    if (pmid && preFetchedData[pmid]) {
                        const result = await summarizePreFetchedContent(preFetchedData[pmid], needsRateExtraction);
                        databefore = result.summary;
                    } else {
                        // Fallback to sequential slow extraction if missing from batch or missing PMID
                        const res = await summarizeText(article.pubmed, needsRateExtraction);
                        if (res) databefore = res.summary;
                    }

                    // Check if no data found
                    if (!databefore || databefore === "NO_CONTENT") {
                        console.log(`    [Article ${currentCount}] No data found or abstract missing for this article. Saving basic info.`);

                        if (databefore !== "NO_CONTENT") {
                            // Only increment when the AI API actually failed
                            global.consecutiveAIFailures++;
                            if (global.consecutiveAIFailures >= 10) {
                                console.error(`\n🚨🚨🚨 CRITICAL SYSTEM CRASH 🚨🚨🚨`);
                                console.error(`10 consecutive requests failed to get AI extraction (after their 30 internal retries).`);
                                console.error(`APIs might be unresponsive or completely blocked. Crashing now to prevent data loss.`);
                                console.error(`Progress was saved at the end of the previous batch. You can safely re-run later.\n`);
                                process.exit(1);
                            }
                        } else {
                            // Reset failure count since this is an intended skip, not an API crash
                            global.consecutiveAIFailures = 0;
                        }
                        data = [{}];
                    } else {
                        // Use the new robust extraction function
                        data = extractJSONArray(databefore);

                        if (!data || !Array.isArray(data)) {
                            console.log(`    [Article ${currentCount}] Data before JSON extraction:`, databefore.substring(0, 200) + "...");
                            console.log(`    [Article ${currentCount}] Failed to parse JSON array from AI output, saving basic article info.`);
                            // Optionally save to a file for debugging
                            require('fs').appendFileSync('failed_json_logs.txt', `\n\n--- FAIL ${new Date().toISOString()} ---\n${databefore}`);
                            global.consecutiveAIFailures++;
                            if (global.consecutiveAIFailures >= 10) {
                                console.error(`\n🚨🚨🚨 CRITICAL SYSTEM CRASH 🚨🚨🚨`);
                                console.error(`10 consecutive requests failed to parse AI extraction (potential API change or model degradation).`);
                                console.error(`Crashing now to prevent junk data from saving to the database.`);
                                console.error(`Progress was saved at the end of the previous batch. You can safely re-run later.\n`);
                                process.exit(1);
                            }
                            data = [{}];
                        } else {
                            console.log(`    [Article ${currentCount}] Number of records extracted:`, data.length);
                            if (data.length === 0) {
                                console.log(`    [Article ${currentCount}] No records found by AI for this article. Saving basic info.`);
                                data = [{}];
                                // Empty records might not be an API fail, but let's reset it since API technically worked
                                global.consecutiveAIFailures = 0;
                            } else {
                                // Success! Reset the consecutive failure count
                                global.consecutiveAIFailures = 0;
                            }
                        }
                    }
                }

                // Process each record in the data array
                for (const record of data) {

                    let finalProductId = 0;
                    let finalRootName = "Unknown";
                    let extractedItemName = record.root_name;
                    let extractedDiseases = record.diseases;

                    const isItemNameValid = extractedItemName && extractedItemName !== 'null' && extractedItemName !== 'None' && String(extractedItemName).trim() !== '';

                    if (!isItemNameValid) {
                        extractedItemName = null;
                    } else {
                        const cleanItemName = extractedItemName.toLowerCase().trim();
                        let targetId = 0;

                        // 1. Look up in ai_to_full_roots_mappings first (which contains robust fuzzy matching data)
                        const mapping = global.aiToFullMappings[cleanItemName];
                        if (mapping && mapping.mapped && mapping.fullRootsRecord && mapping.fullRootsRecord.id) {
                            targetId = parseInt(mapping.fullRootsRecord.id, 10) || 0;
                        }
                        // 2. Exact match check in Full-Roots.json index as fallback
                        else if (global.fullRootsIndex.has(cleanItemName)) {
                            targetId = global.fullRootsIndex.get(cleanItemName);
                        }

                        finalProductId = targetId;
                        finalRootName = cleanItemName;
                    }

                    const diseaseTargets = record.disease_targets && Array.isArray(record.disease_targets) ? record.disease_targets : [];
                    if (diseaseTargets.length === 0) {
                        // Fallback if AI didn't provide disease targets, use the batch disease as a dummy
                        diseaseTargets.push({
                            disease_name: resultObj.disease_name,
                            root_causes: record.root_causes || [], // In case it hallucinates old schema
                            labs: record.labs || []
                        });
                    }

                    for (const dt of diseaseTargets) {
                        let finalDiseaseId = resultObj.disease_id;
                        let finalDiseaseName = dt.disease_name || resultObj.disease_name;

                        const isDiseaseValid = finalDiseaseName && finalDiseaseName !== 'null' && finalDiseaseName !== 'None' && String(finalDiseaseName).trim() !== '';

                        if (isDiseaseValid) {
                            let cleanDiseaseName = finalDiseaseName.toLowerCase()
                                .replace(/[^a-z0-9\s]/g, ' ')
                                .replace(/\s+/g, ' ')
                                .trim();

                            // Let fuzzy word sorter handle any reordered words
                            let targetDiseaseId = null;

                            if (global.diseaseMappings.map.has(cleanDiseaseName)) {
                                targetDiseaseId = global.diseaseMappings.map.get(cleanDiseaseName);
                                // Unify to canonical name for this ID to prevent duplicate scoped maps
                                for (const [k, v] of global.diseaseMappings.map.entries()) {
                                    if (v === targetDiseaseId) {
                                        cleanDiseaseName = k;
                                        break;
                                    }
                                }
                            } else {
                                let bestMatchKey = null;
                                let highestSim = 0;

                                for (const existingKey of global.diseaseMappings.map.keys()) {
                                    const sim = calculateSimilarity(cleanDiseaseName, existingKey);
                                    const isSubString = (cleanDiseaseName.length > 5 && existingKey.includes(cleanDiseaseName)) ||
                                        (existingKey.length > 5 && cleanDiseaseName.includes(existingKey));

                                    const subsetScore = calculateWordSubset(cleanDiseaseName, existingKey);

                                    let currentSim = sim;
                                    if (isSubString && sim > 0.5) currentSim = Math.max(currentSim, 0.88);

                                    if (subsetScore >= 0.85 && sim > 0.2) {
                                        currentSim = Math.max(currentSim, 0.90);
                                    }

                                    if (subsetScore === 1.0 && cleanDiseaseName.length > 5 && existingKey.length > 5) {
                                        currentSim = Math.max(currentSim, 0.95);
                                    }

                                    if (currentSim > highestSim) {
                                        highestSim = currentSim;
                                        bestMatchKey = existingKey;
                                    }
                                }

                                if (highestSim >= 0.85 && bestMatchKey) {
                                    targetDiseaseId = global.diseaseMappings.map.get(bestMatchKey);
                                    // Unify to canonical name
                                    for (const [k, v] of global.diseaseMappings.map.entries()) {
                                        if (v === targetDiseaseId) {
                                            cleanDiseaseName = k;
                                            break;
                                        }
                                    }
                                    console.log(`    🔗 Fuzzy matched disease: "${finalDiseaseName}" -> mapped to existing "${cleanDiseaseName}" (Sim: ${(highestSim * 100).toFixed(1)}%)`);
                                } else {
                                    targetDiseaseId = global.diseaseMappings.nextIndex;
                                    global.diseaseMappings.map.set(cleanDiseaseName, targetDiseaseId);
                                    global.diseaseMappings.nextIndex = targetDiseaseId + 1;
                                    global.diseaseMappings.needsSave = true;
                                    console.log(`    🦠 New disease identified: "${cleanDiseaseName}" (from "${finalDiseaseName}") -> Disease ID ${targetDiseaseId}`);
                                }
                            }
                            finalDiseaseId = targetDiseaseId;
                            finalDiseaseName = cleanDiseaseName;
                        }

                        uniqueDiseaseIds.add(finalDiseaseId);

                        // Scoped mapping logic for root causes per disease
                        if (!global.scopedRootCauseMaps[finalDiseaseName]) {
                            global.scopedRootCauseMaps[finalDiseaseName] = { map: new Map(), nextIndex: global.globalNextIndex, needsSave: true };
                        }
                        const rcScope = global.scopedRootCauseMaps[finalDiseaseName];

                        // Prepare result object with base fields
                        const cleanName = finalDiseaseName.toLowerCase().trim();
                        const icdInfo = global.icd11DiseaseMappings[cleanName] || {};
                        const codeVal = icdInfo.mapped ? (icdInfo.code || null) : null;
                        const urlVal = icdInfo.mapped ? (icdInfo.foundationUri || null) : null;
                        const titleVal = icdInfo.mapped ? (icdInfo.title || null) : null;

                        const dbResult = {
                            name: `${finalRootName} and ${finalDiseaseName}`,
                            title: article.title,
                            pubtypes: article.pubtypes !== undefined && article.pubtypes !== null ? article.pubtypes : null,
                            ai_pubtypes: record.pubtypes !== undefined && record.pubtypes !== null ? record.pubtypes : null,
                            rate: article.rate !== undefined && article.rate !== null ? parseInt(article.rate) : null,
                            disease_rates: typeof record.disease_rates === 'number' ? record.disease_rates : article.rate, // Use AI rate, fallback to NCBI rate
                            pmc: article.pmc,
                            processing_status: record.processing_status || null,
                            root_name: finalRootName,
                            scientific_name: record.scientific_name || null,
                            disease: finalDiseaseName,
                            pubmed: article.pubmed,
                            PMID: article.PMID,
                            productId: finalProductId,
                            diseaseId: finalDiseaseId,
                            articles_count: resultObj.articles_count,
                            category: resultObj.category,
                            calculated_dw: resultObj.calculated_dw,
                            article_number: article.article_number || (resultObj.articles ? resultObj.articles.indexOf(article) + 1 : 1),
                            doi: article.doi,
                            DOI: article.DOI,
                            PMCID: article.PMCID,
                            code: codeVal,
                            foundation_url: urlVal,
                            icd_title: titleVal
                        };

                        // Extract and align infinite root causes dynamically based on the global scoped mapping
                        const dbDynamicRootCauses = {}; // JSON block for the new DB column
                        const extractedRootCauses = [];

                        if (dt.root_causes && Array.isArray(dt.root_causes)) {
                            for (const rc of dt.root_causes) {
                                const hasName = rc.name && typeof rc.name === 'string' && rc.name.trim() !== '';
                                const hasBenefitExactly = rc.benefit_exactly && typeof rc.benefit_exactly === 'string' && rc.benefit_exactly.trim() !== '';
                                const hasBenefitDescriptive = rc.benefit_descriptive && typeof rc.benefit_descriptive === 'string' && rc.benefit_descriptive.trim() !== '';

                                if (hasName || hasBenefitExactly || hasBenefitDescriptive) {
                                    extractedRootCauses.push({
                                        name: hasName ? rc.name.trim() : "Unknown Root Cause",
                                        benefit_exactly: hasBenefitExactly ? rc.benefit_exactly.trim() : null,
                                        benefit_descriptive: hasBenefitDescriptive ? rc.benefit_descriptive.trim() : null
                                    });
                                }
                            }
                        }

                        // Assign root causes to deterministic global mappings
                        for (const rc of extractedRootCauses) {
                            // 1. Basic Normalization (lowercase, trim)
                            let rawLower = rc.name.toLowerCase().trim();

                            // 2. Advanced Normalization (remove disease context dynamically)
                            const diseaseLower = diseaseName ? diseaseName.toLowerCase().trim() : "";
                            let cleanName = rawLower;

                            // Extract significant words from the disease name to use as generic filters
                            const diseaseWords = diseaseLower.split(/[\s,]+/).filter(w => w.length > 3 && !['type', 'disease', 'syndrome', 'disorder'].includes(w));

                            // General stop phrases that apply to any disease
                            const stopPhrases = [
                                diseaseLower ? `in ${diseaseLower}` : null,
                                diseaseLower ? `in ${diseaseLower} patients` : null,
                                "exacerbating depressive symptoms",
                                "contributing to depression",
                                "as a potential contributing factor",
                                "in the onset and progression of",
                                "in the development of",
                                "in the pathogenesis of",
                                "associated with",
                                "in patients with"
                            ].filter(Boolean);

                            for (const phrase of stopPhrases) {
                                if (phrase && phrase.length > 3) {
                                    cleanName = cleanName.replace(new RegExp(`\\b${phrase.replace(/[.*+?^$\{()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'g'), '');
                                }
                            }

                            // Intelligent split: if the string ends with context about the disease or patients, remove it.
                            // Example: "oxidative stress in diabetes", "inflammation among cancer patients"
                            const splitKeywords = [" in ", " among ", " during ", " for "];
                            for (const kw of splitKeywords) {
                                if (cleanName.includes(kw)) {
                                    const parts = cleanName.split(kw);
                                    const rightPart = parts[parts.length - 1].trim(); // Get the last part

                                    // Check if the right side contains a disease word or a general patient/context word
                                    const hasDiseaseWord = diseaseWords.some(w => rightPart.includes(w));
                                    const hasPatientWord = ['patient', 'tissue', 'model', 'cell', 'disease', 'syndrome', 'subject'].some(w => rightPart.includes(w));

                                    if (hasDiseaseWord || hasPatientWord) {
                                        parts.pop(); // Remove the rightmost part
                                        const leftPart = parts.join(kw).trim();
                                        if (leftPart.length > 4) {
                                            cleanName = leftPart;
                                        }
                                    }
                                }
                            }

                            cleanName = cleanName.replace(/\s+/g, ' ').trim();
                            // If we stripped too much, fallback to raw
                            if (cleanName.length < 3) cleanName = rawLower;

                            let targetIndex;

                            // 3. Exact and Fuzzy Matching
                            if (rcScope.map.has(cleanName)) {
                                targetIndex = rcScope.map.get(cleanName);
                            } else if (rcScope.map.has(rawLower)) {
                                targetIndex = rcScope.map.get(rawLower);
                            } else {
                                let bestMatchKey = null;
                                let highestSim = 0;

                                for (const existingKey of rcScope.map.keys()) {
                                    const sim = calculateSimilarity(cleanName, existingKey);

                                    const isSubString = (cleanName.length > 6 && existingKey.includes(cleanName)) ||
                                        (existingKey.length > 6 && cleanName.includes(existingKey));

                                    const subsetScore = calculateWordSubset(cleanName, existingKey);

                                    let currentSim = sim;

                                    if (isSubString && sim > 0.6) { // Boost if it's a substring
                                        currentSim = Math.max(currentSim, 0.88);
                                    }

                                    if (subsetScore >= 0.85 && sim > 0.4) {
                                        currentSim = Math.max(currentSim, 0.90);
                                    }

                                    if (currentSim > highestSim) {
                                        highestSim = currentSim;
                                        bestMatchKey = existingKey;
                                    }
                                }

                                // Threshold for matching (85% similarity)
                                if (highestSim >= 0.85 && bestMatchKey) {
                                    targetIndex = rcScope.map.get(bestMatchKey);
                                    console.log(`    🔗 Fuzzy matched root cause: "${rc.name}" -> mapped to existing "${bestMatchKey}" (Sim: ${(highestSim * 100).toFixed(1)}%)`);
                                } else {
                                    targetIndex = global.globalNextIndex;
                                    rcScope.map.set(cleanName, targetIndex);
                                    rcScope.nextIndex = targetIndex + 1;
                                    global.globalNextIndex++;
                                    rcScope.needsSave = true; // Mark for persistence
                                    console.log(`    🆕 New root cause identified: "${cleanName}" (from "${rc.name}") -> Index ${targetIndex}`);
                                }
                            }

                            // Write to the matched dynamic dictionary
                            if (!dbDynamicRootCauses[targetIndex]) {
                                dbDynamicRootCauses[targetIndex] = {
                                    name: rc.name,
                                    benefit_exactly: rc.benefit_exactly,
                                    benefit_descriptive: rc.benefit_descriptive
                                };
                            } else {
                                if (rc.benefit_exactly && dbDynamicRootCauses[targetIndex].benefit_exactly !== rc.benefit_exactly) {
                                    dbDynamicRootCauses[targetIndex].benefit_exactly += ` | ${rc.benefit_exactly}`;
                                }
                                if (rc.benefit_descriptive && dbDynamicRootCauses[targetIndex].benefit_descriptive !== rc.benefit_descriptive) {
                                    dbDynamicRootCauses[targetIndex].benefit_descriptive += ` | ${rc.benefit_descriptive}`;
                                }
                            }
                        }

                        // Attach the dynamic JSON column object
                        dbResult.dynamic_root_causes = dbDynamicRootCauses;

                        // Handle lab measures if present in the record
                        let hasLabs = false;
                        let validLabs = [];
                        if (dt.labs && Array.isArray(dt.labs)) {
                            for (const lab of dt.labs) {
                                if (lab.type) {
                                    hasLabs = true;
                                    let labType = lab.type;
                                    if (labType === 'urinary_albumin_to_creatinine_ratio') {
                                        labType = 'uacr';
                                    }
                                    validLabs.push({
                                        type: labType,
                                        name: lab.name || null,
                                        benefit: lab.benefit || null,
                                        short_description: lab.short_description || null,
                                        quantity: lab.quantity || null
                                    });
                                }
                            }
                        }

                        if (hasLabs) {
                            dbResult.labs = validLabs;
                        } else {
                            dbResult.labs = null;
                        }

                        let hasAnyRootCauseBenefit = false;
                        for (const rc of extractedRootCauses) {
                            if ((rc.benefit_exactly && typeof rc.benefit_exactly === 'string' && rc.benefit_exactly.trim() !== '') ||
                                (rc.benefit_descriptive && typeof rc.benefit_descriptive === 'string' && rc.benefit_descriptive.trim() !== '')) {
                                hasAnyRootCauseBenefit = true;
                                break;
                            }
                        }

                        let hasAnyLabBenefit = false;
                        for (const lab of validLabs) {
                            if (lab.benefit && typeof lab.benefit === 'string' && lab.benefit.trim() !== '') {
                                hasAnyLabBenefit = true;
                                break;
                            }
                        }

                        if (!hasAnyRootCauseBenefit && !hasAnyLabBenefit) {
                            dbResult.diseases_rate_all_null = 0;
                        } else {
                            dbResult.diseases_rate_all_null = null;
                        }

                        // Calculate disease_rate_combination physically
                        if (dbResult.diseases_rate_all_null === 0) {
                            dbResult.disease_rate_combination = 0;
                        } else {
                            dbResult.disease_rate_combination = dbResult.disease_rates;
                        }

                        articleDbResults.push(dbResult);
                    } // End of diseaseTargets loop
                } // End of record data loop
                console.log(`    [Article ${currentCount}] ----------------------------------------------------------------------------------`);
                return articleDbResults;
            } catch (err) {
                if (err.message && err.message.includes("ConnectionManager.getConnection was called after the connection manager was closed!")) {
                    console.log(`    [Article ${currentCount}] ⚠️ Article DB Save failed because connection manager was closed.`);
                } else {
                    console.log(`    [Article ${currentCount}] Error processing article: ${err.message}`);
                }
                return null;
            }
        });

        // Wait for all promises in the batch to complete concurrently
        const batchResults = await Promise.all(batchPromises);

        for (const resList of batchResults) {
            if (Array.isArray(resList)) {
                recordsToInsert.push(...resList);
            }
        }

        // Save valid items to DB using Bulk Insert
        if (recordsToInsert.length > 0) {
            if (sequelize.connectionManager && sequelize.connectionManager.pool && sequelize.connectionManager.pool._state === 'closed') {
                console.warn(`    ⚠️ Skipping DB bulk save: Connection manager is closed. Lost ${recordsToInsert.length} records.`);
            } else {
                try {
                    await ResearchResult.bulkCreate(recordsToInsert);
                    console.log(`    ✅ Bulk inserted ${recordsToInsert.length} records into Database.`);
                } catch (err) {
                    console.log(`    ⚠️ Error during bulk insert: ${err.message}`);
                }
            }
        }
    }

    // Save mapping persistence independently after all batch processing
    let shouldSaveMap = false;
    const rawToSave = {};
    for (const [disease, scope] of Object.entries(global.scopedRootCauseMaps)) {
        if (scope.needsSave) shouldSaveMap = true;
        rawToSave[disease] = {
            mapData: Object.fromEntries(scope.map),
            nextIndex: global.globalNextIndex
        };
    }
    if (shouldSaveMap) {
        const tempMapFile = path.join(__dirname, 'root_cause_mappings.tmp.json');
        const finalMapFile = path.join(__dirname, 'root_cause_mappings.json');
        fs.writeFileSync(tempMapFile, JSON.stringify(rawToSave, null, 2));
        fs.renameSync(tempMapFile, finalMapFile);

        for (const scope of Object.values(global.scopedRootCauseMaps)) {
            scope.needsSave = false;
        }
        console.log(`    💾 Saved globally persistent root cause map column alignments.`);
    }

    if (global.itemMappings && global.itemMappings.needsSave) {
        const ITEM_MAPPINGS_FILE = path.join(__dirname, 'item_mappings.json');
        const tempItemMapFile = ITEM_MAPPINGS_FILE + '.tmp';
        const rawItemSave = {
            mapData: Object.fromEntries(global.itemMappings.map),
            nextIndex: global.itemMappings.nextIndex
        };
        fs.writeFileSync(tempItemMapFile, JSON.stringify(rawItemSave, null, 2));
        fs.renameSync(tempItemMapFile, ITEM_MAPPINGS_FILE);
        global.itemMappings.needsSave = false;
        console.log(`    💾 Saved globally persistent dynamic item mappings.`);
    }

    if (global.diseaseMappings && global.diseaseMappings.needsSave) {
        const DISEASE_MAPPINGS_FILE = path.join(__dirname, 'disease_mappings.json');
        const tempDiseaseMapFile = DISEASE_MAPPINGS_FILE + '.tmp';
        const rawDiseaseSave = {
            mapData: Object.fromEntries(global.diseaseMappings.map),
            nextIndex: global.diseaseMappings.nextIndex
        };
        fs.writeFileSync(tempDiseaseMapFile, JSON.stringify(rawDiseaseSave, null, 2));
        fs.renameSync(tempDiseaseMapFile, DISEASE_MAPPINGS_FILE);
        global.diseaseMappings.needsSave = false;
        console.log(`    💾 Saved globally persistent dynamic disease mappings.`);
    }

    return Array.from(uniqueDiseaseIds);
}

/**
 * Main function that reads from XLSX and calls getURL for all products
 */
async function main() {
    console.log("🔍 Starting research processing from XLSX...");

    try {
        const { Op } = require("sequelize");
        // const workbook = XLSX.readFile('Diabetes_Mellitus_Type_2_ready_articles.xls');
        const workbook = XLSX.readFile('new Script data.xlsx');
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        const allRows = XLSX.utils.sheet_to_json(sheet);

        // 1. Dynamic item mapping is now handled entirely within getURL.js using item_mappings.json
        // We no longer load Full-Roots.json or pre-compile regexes here.

        const PROGRESS_FILE = path.join(__dirname, 'progress.json');
        let progress = { currentIndex: 0 };

        if (fs.existsSync(PROGRESS_FILE)) {
            try {
                progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
                console.log(`\n🔄 Resuming from row ${progress.currentIndex}...`);
            } catch (e) {
                console.error('⚠️ Error reading progress file. Starting from beginning.');
            }
        }

        while (progress.currentIndex < allRows.length) {
            const nextIndex = Math.min(progress.currentIndex + 100, allRows.length);
            console.log(`\n======================================================`);
            console.log(`🚀 Processing rows from ${progress.currentIndex} to ${nextIndex - 1} of ${allRows.length} (Batch Size: 100)`);
            console.log(`======================================================\n`);

            const currentBatch = allRows.slice(progress.currentIndex, nextIndex);

            // Process only current batch
            const rawArticles = currentBatch.map(article => {
                // Extract IDs similar to before
                if (article.pubmed && !article.PMID) {
                    const match = article.pubmed.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);
                    article.PMID = match ? match[1] : null;
                }
                if (article.pmc && !article.PMCID) {
                    const match = article.pmc.match(/pmc\/articles\/(PMC\d+)/);
                    article.PMCID = match ? match[1] : null;
                }
                if (article.doi && !article.DOI) {
                    const match = article.doi.match(/doi\.org\/(.+)/);
                    article.DOI = match ? match[1] : null;
                }
                return article;
            });

            if (rawArticles.length === 0) {
                console.log("    No articles found in this batch.");
                progress.currentIndex = nextIndex;
                const tempProgress = PROGRESS_FILE + '.tmp';
                fs.writeFileSync(tempProgress, JSON.stringify(progress));
                fs.renameSync(tempProgress, PROGRESS_FILE);
                continue;
            }

            // Create a single pseudo-group for the batch
            // The item mapping will be dynamically assigned during extraction.
            const pseudoGroup = {
                id: 0, // Assigned dynamically later
                root_name: "Dynamic", // Assigned dynamically later
                disease_id: 28, // Default to 28 based on provided JSON
                disease_name: "Type 2 Diabetes",
                articles_count: rawArticles.length,
                category: "ready",
                calculated_dw: 0,
                articles: rawArticles
            };

            const resultsDataArray = [pseudoGroup];

            console.log(`🔍 Extracted ${resultsDataArray.length} product groups from batch. Processing AI Summaries...`);

            if (resultsDataArray.length > 0) {
                // Await getURL processing and get touched diseases
                const touchedDiseaseIds = await getURL(resultsDataArray);

                console.log(`\n🔄 Starting Post-Processing (Updates, Recalculations, Sorting) for batch...`);

                for (const diseaseId of touchedDiseaseIds) {
                    console.log(`\n  >> Post-Processing for disease ID: ${diseaseId}`);

                    // --- Post Processing Step 1.5: Remove duplicates caused by 'another_item' mapping ---
                    console.log(`   🔄 Removing duplicate articles...`);

                    const allRecordsToCheck = await ResearchResult.findAll({
                        where: { diseaseId: diseaseId },
                        order: [
                            ['productId', 'ASC'],
                            ['createdAt', 'ASC'] // Keep the oldest/first inserted
                        ]
                    });

                    const articleProductMap = new Map();
                    for (const record of allRecordsToCheck) {
                        // Find a robust unique identifier for the article
                        let articleKey = '';
                        if (record.PMID) articleKey = `PMID_${record.PMID}`;
                        else if (record.doi || record.DOI) articleKey = `DOI_${record.doi || record.DOI}`;
                        else if (record.pubmed) articleKey = `PUBMED_${record.pubmed}`;
                        else if (record.title) articleKey = `TITLE_${record.title.substring(0, 50).toLowerCase()}`;
                        else articleKey = `ID_${record.id}`;

                        const key = `${record.productId}_${articleKey}`;

                        if (!articleProductMap.has(key)) {
                            articleProductMap.set(key, []);
                        }
                        articleProductMap.get(key).push(record);
                    }

                    const duplicateIdsToRemove = [];

                    for (const [key, records] of articleProductMap.entries()) {
                        if (records.length > 1) {
                            // Keep exactly one record per (productId, article). 
                            // Since all items are directly extracted, we just keep the first one and discard the rest.
                            for (let i = 1; i < records.length; i++) duplicateIdsToRemove.push(records[i].id);
                        }
                    }

                    if (duplicateIdsToRemove.length > 0) {
                        await ResearchResult.destroy({ where: { id: duplicateIdsToRemove } });
                        console.log(`   ✅ Removed ${duplicateIdsToRemove.length} duplicate records to prevent overlapping.`);
                    } else {
                        console.log(`   ✅ No duplicates found.`);
                    }

                    // --- Post Processing Step 2: Recalculate DW and counts ---
                    console.log(`   🔄 Recalculating DW and counts for all products...`);
                    const allRecordsInDisease = await ResearchResult.findAll({
                        where: { diseaseId: diseaseId },
                        order: [
                            ['productId', 'ASC'],
                            ['article_number', 'ASC']
                        ]
                    });

                    const groupMap = new Map();
                    for (const record of allRecordsInDisease) {
                        const pid = record.productId;
                        if (!pid || pid == 0) continue;
                        if (!groupMap.has(pid)) groupMap.set(pid, []);
                        groupMap.get(pid).push(record);
                    }

                    let recalcUpdates = 0;
                    const recalcPromises = [];

                    for (const [pid, records] of groupMap.entries()) {
                        const uniqueArticlesMap = new Map();
                        for (const record of records) {
                            const articleKey = String(record.PMID || record.pubmed || record.title || record.id).trim();
                            if (!uniqueArticlesMap.has(articleKey)) {
                                uniqueArticlesMap.set(articleKey, {
                                    key: articleKey,
                                    rate: (record.disease_rate_combination !== null && record.disease_rate_combination !== undefined) ? record.disease_rate_combination : 0,
                                    records: []
                                });
                            }
                            uniqueArticlesMap.get(articleKey).records.push(record);
                        }

                        const uniqueArticles = Array.from(uniqueArticlesMap.values());
                        const articles_count = uniqueArticles.length;
                        const category = articles_count <= 173 ? "ready" : "not_ready";

                        const rates = uniqueArticles.map(a => a.rate == 0 ? 1 : a.rate);
                        let calculated_dw = 0;
                        if (rates.length > 0) {
                            const sum = rates.reduce((a, b) => a + b, 0);
                            const max = Math.max(...rates);
                            calculated_dw = sum * max;
                        }

                        uniqueArticles.sort((a, b) => b.rate - a.rate);

                        for (let j = 0; j < uniqueArticles.length; j++) {
                            const articleGroup = uniqueArticles[j];
                            const newArticleNumber = String(j + 1);

                            for (const record of articleGroup.records) {
                                if (
                                    record.articles_count !== articles_count ||
                                    record.calculated_dw !== calculated_dw ||
                                    String(record.article_number) !== newArticleNumber ||
                                    record.category !== category
                                ) {
                                    recalcPromises.push(record.update({
                                        articles_count,
                                        calculated_dw,
                                        article_number: newArticleNumber,
                                        category
                                    }));
                                    recalcUpdates++;
                                }
                            }
                        }
                    }

                    await Promise.all(recalcPromises);
                    console.log(`   ✅ Recalculated DW and counts updated ${recalcUpdates} records.`);

                    // --- Post Processing Step 3: Physically sorting the rows ---
                    console.log(`   🔄 Physically sorting the rows in the database...`);
                    const finalSortedRecords = await ResearchResult.findAll({
                        where: { diseaseId: diseaseId },
                        order: [
                            ['productId', 'ASC'],
                            [sequelize.literal('NULLIF("article_number", \'\')::INTEGER'), 'ASC']
                        ],
                        raw: true
                    });

                    if (finalSortedRecords.length > 0) {
                        await ResearchResult.destroy({ where: { diseaseId: diseaseId } });
                        const recordsToInsert = finalSortedRecords.map(r => {
                            delete r.id; // Allow DB to auto-generate a fresh, sorted ID
                            return r;
                        });
                        await ResearchResult.bulkCreate(recordsToInsert);
                        console.log(`   ✅ Disease ${diseaseId} database rows physically sorted.`);
                    }
                } // End loop over touchedDiseaseIds
            } // end if resultsDataArray.length > 0

            // Advance progress after batch is completely processed
            progress.currentIndex = nextIndex;
            const tempProgress = PROGRESS_FILE + '.tmp';
            fs.writeFileSync(tempProgress, JSON.stringify(progress));
            fs.renameSync(tempProgress, PROGRESS_FILE);
            console.log(`\n✅ Batch completed and Progress safely saved! Reached row ${progress.currentIndex}.\n`);
        } // end while loop

        console.log("🎊 All rows processed successfully!");

    } catch (error) {
        console.error("❌ Error in main execution:", error.message);
    }
}

// Export functions for use in other modules
module.exports = {
    getURL,
    summarizeText,
    calculateSimilarity,
    calculateWordSubset
};

// Immediately Invoked Function Expression (IIFE) to run the script if called directly
if (require.main === module) {
    (async () => {
        try {
            // Test database connection
            await sequelize.authenticate();
            console.log("✅ Connected to DB");
            await sequelize.sync({ alter: true });
            console.log("📦 Tables synced");
            // Run main processing function
            await main();
        } catch (error) {
            console.error("❌ Unable to connect to the database:", error);
        } finally {
            // Close database connection when done
            await sequelize.close();
        }
    })();
}