require("dotenv").config();
const { ResearchResult, sequelize } = require("./models/all");
const { summarizeText, preFetchBatchArticles, summarizePreFetchedContent } = require("./getContent");
const { Op } = require("sequelize");
const fs = require("fs");
const path = require("path");
const util = require("util");
const { calculateSimilarity, calculateWordSubset } = require("./getURL");

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

const pubTypeRates = {
    "Systematic Review": 5,
    "Meta-Analysis": 5,
    "Randomized Controlled Trial": 4,
    "Controlled Clinical Trial": 4,
    "Clinical Trial": 4,
    "Clinical Trial Protocol": 3,
    "Multicenter Study": 3,
    "Observational Study": 3,
    "Comparative Study": 3,
    "Evaluation Study": 3,
    "Validation Studies": 3,
    "Case Reports": 2,
    "Review": 2,
    "Technical Report": 2,
    "Editorial": 1,
    "Letter": 1,
    "Comment": 1,
    "Consensus Development Conference": 1,
    "Practice Guideline": 1,
    "Guideline": 1,
    "Retracted Publication": 1,
    "Corrected and Republished Article": 1,
};

function extractJSONArray(text) {
    if (!text) return null;

    if (typeof text !== 'string') {
        if (Array.isArray(text)) return text;
        if (typeof text === 'object') return [text];
        text = String(text);
    }

    const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    let content = markdownMatch ? markdownMatch[1] : text;

    const firstBracket = content.indexOf('[');
    if (firstBracket === -1) {
        return null;
    }

    content = content.substring(firstBracket);

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
            if (char === '\n') result += '\\n';
            else if (char === '\r') result += '\\r';
            else if (char === '\t') result += '\\t';
            else result += char;
            isEscaped = false;
        } else {
            if (char === '[') openBrackets++;
            else if (char === ']') openBrackets = Math.max(0, openBrackets - 1);
            else if (char === '{') openBraces++;
            else if (char === '}') openBraces = Math.max(0, openBraces - 1);

            result += char;
            isEscaped = false;
        }

        if (!inString && openBrackets === 0 && openBraces === 0 && i > 0) {
            break;
        }
    }

    if (inString) result += '"';
    while (openBraces > 0) { result += '}'; openBraces--; }
    while (openBrackets > 0) { result += ']'; openBrackets--; }

    result = result.replace(/,\s*\]/g, ']').replace(/,\s*\}/g, '}');

    try { return JSON.parse(result); } catch (e) { return null; }
}

async function runPostProcessing(diseaseId, diseaseName) {
    console.log(`\n🔄 Starting Post-Processing for disease ${diseaseName}...`);

    // --- Post Processing Step 1.5: Remove duplicates ---
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
        console.log(`   ✅ Disease ${diseaseName} database rows physically sorted.`);
    }
}

async function main() {
    await sequelize.authenticate();
    console.log("✅ Connected to DB");

    // Load dynamic mapping tables
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

    // Query failed AI Extractions (where root_name is unknown or empty/null/etc)
    const failedRecords = await ResearchResult.findAll({
        where: {
            category: 'ready',
            [Op.or]: [
                { root_name: null },
                { root_name: '' },
                { root_name: { [Op.iLike]: 'null' } },
                { root_name: { [Op.iLike]: 'none' } },
                { root_name: { [Op.iLike]: 'not mentioned' } },
                { root_name: { [Op.iLike]: 'unknown' } }
            ]
        }
    });

    console.log(`\n🔍 Found ${failedRecords.length} records with missing/failed AI fields. Starting retry logic...\n`);

    if (failedRecords.length === 0) {
        console.log("No failed AI records found. Exiting.");
        return;
    }

    const CONCURRENCY_LIMIT = 100; // Reduced to 30 to avoid API rate limits (429)
    const affectedDiseases = new Map(); // to store diseaseId -> diseaseName

    let totalSuccess = 0;
    let totalFailedFetch = 0;
    let totalFailedParse = 0;
    let totalFailedEmpty = 0;

    for (let i = 0; i < failedRecords.length; i += CONCURRENCY_LIMIT) {
        const batch = failedRecords.slice(i, i + CONCURRENCY_LIMIT);

        let recordsToInsert = [];
        let deletedRecordIds = [];

        console.log(`\n🚀 Processing Retries ${i} to ${Math.min(i + CONCURRENCY_LIMIT, failedRecords.length) - 1} of ${failedRecords.length}...`);

        // PRE-FETCH entire batch at once in bulk
        let preFetchedData = {};
        try {
            preFetchedData = await preFetchBatchArticles(batch);
        } catch (e) {
            console.error("⚠️ Error pre-fetching batch articles:", e.message);
        }

        const batchPromises = batch.map(async (record) => {
            const needsRateExtraction = record.disease_rates === 0 || record.disease_rates === null;

            console.log(`   [Retry] Requesting AI for: ${record.title} (${record.pubmed})`);

            let databefore = null;
            const pmid = record.PMID;

            if (pmid && preFetchedData[pmid]) {
                const result = await summarizePreFetchedContent(preFetchedData[pmid], needsRateExtraction);
                databefore = result.summary;
            } else {
                const res = await summarizeText(record.pubmed, needsRateExtraction);
                if (res) databefore = res.summary;
            }

            if (!databefore) {
                console.log(`   [Retry Failed] Error retrieving summary for ${record.pubmed}`);
                totalFailedFetch++;
                return null;
            }

            let data = extractJSONArray(databefore);
            if (!data || !Array.isArray(data)) {
                console.log(`   [Retry Failed] Could not parse valid JSON array for ${record.pubmed}`);
                totalFailedParse++;
                return null;
            }
            if (data.length === 0) {
                console.log(`   [Retry Failed] AI returned an empty array for ${record.pubmed}`);
                totalFailedEmpty++;
                return null;
            }

            console.log(`   [Retry Success] Extracted ${data.length} records for ${record.pubmed}`);
            totalSuccess++;
            deletedRecordIds.push(record.id);

            const articleDbResults = [];
            for (const item of data) {
                let finalProductId = 0;
                let finalRootName = "Unknown";
                let extractedItemName = item.root_name;

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

                const diseaseTargets = item.disease_targets && Array.isArray(item.disease_targets) ? item.disease_targets : [];
                if (diseaseTargets.length === 0) {
                    diseaseTargets.push({
                        disease_name: record.disease,
                        root_causes: item.root_causes || [],
                        labs: item.labs || []
                    });
                }

                for (const dt of diseaseTargets) {
                    let finalDiseaseId = record.diseaseId;
                    let finalDiseaseName = dt.disease_name || record.disease;

                    const isDiseaseValid = finalDiseaseName && finalDiseaseName !== 'null' && finalDiseaseName !== 'None' && String(finalDiseaseName).trim() !== '';

                    if (isDiseaseValid) {
                        let cleanDiseaseName = finalDiseaseName.toLowerCase()
                            .replace(/[^a-z0-9\s]/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();

                        let targetDiseaseId = null;

                        if (global.diseaseMappings.map.has(cleanDiseaseName)) {
                            targetDiseaseId = global.diseaseMappings.map.get(cleanDiseaseName);
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

                    affectedDiseases.set(finalDiseaseId, finalDiseaseName);

                    if (!global.scopedRootCauseMaps[finalDiseaseName]) {
                        global.scopedRootCauseMaps[finalDiseaseName] = { map: new Map(), nextIndex: global.globalNextIndex, needsSave: true };
                    }
                    const rcScope = global.scopedRootCauseMaps[finalDiseaseName];

                    const cleanName = finalDiseaseName.toLowerCase().trim();
                    const icdInfo = global.icd11DiseaseMappings[cleanName] || {};
                    const codeVal = icdInfo.mapped ? (icdInfo.code || null) : null;
                    const urlVal = icdInfo.mapped ? (icdInfo.foundationUri || null) : null;
                    const titleVal = icdInfo.mapped ? (icdInfo.title || null) : null;

                    const dbResult = {
                        name: `${finalRootName} and ${finalDiseaseName}`,
                        title: record.title,
                        pubtypes: record.pubtypes !== undefined && record.pubtypes !== null ? record.pubtypes : null,
                        ai_pubtypes: item.pubtypes !== undefined && item.pubtypes !== null ? item.pubtypes : null,
                        rate: record.rate !== undefined && record.rate !== null ? parseInt(record.rate) : null,
                        disease_rates: typeof item.disease_rates === 'number' ? item.disease_rates : record.rate,
                        pmc: record.pmc,
                        processing_status: item.processing_status || null,
                        root_name: finalRootName,
                        scientific_name: item.scientific_name || null,
                        disease: finalDiseaseName,
                        pubmed: record.pubmed,
                        PMID: record.PMID,
                        productId: finalProductId,
                        diseaseId: finalDiseaseId,
                        articles_count: record.articles_count,
                        category: record.category,
                        calculated_dw: record.calculated_dw,
                        article_number: record.article_number,
                        doi: record.doi,
                        DOI: record.DOI,
                        PMCID: record.PMCID,
                        code: codeVal,
                        foundation_url: urlVal,
                        icd_title: titleVal
                    };

                    const dbDynamicRootCauses = {};
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

                    for (const rc of extractedRootCauses) {
                        let rawLower = rc.name.toLowerCase().trim();
                        const diseaseLower = finalDiseaseName ? finalDiseaseName.toLowerCase().trim() : "";
                        let cleanName = rawLower;

                        const diseaseWords = diseaseLower.split(/[\s,]+/).filter(w => w.length > 3 && !['type', 'disease', 'syndrome', 'disorder'].includes(w));

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

                        const splitKeywords = [" in ", " among ", " during ", " for "];
                        for (const kw of splitKeywords) {
                            if (cleanName.includes(kw)) {
                                const parts = cleanName.split(kw);
                                const rightPart = parts[parts.length - 1].trim();

                                const hasDiseaseWord = diseaseWords.some(w => rightPart.includes(w));
                                const hasPatientWord = ['patient', 'tissue', 'model', 'cell', 'disease', 'syndrome', 'subject'].some(w => rightPart.includes(w));

                                if (hasDiseaseWord || hasPatientWord) {
                                    parts.pop();
                                    const leftPart = parts.join(kw).trim();
                                    if (leftPart.length > 4) {
                                        cleanName = leftPart;
                                    }
                                }
                            }
                        }

                        cleanName = cleanName.replace(/\s+/g, ' ').trim();
                        if (cleanName.length < 3) cleanName = rawLower;

                        let targetIndex;

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

                                if (isSubString && sim > 0.6) {
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

                            if (highestSim >= 0.85 && bestMatchKey) {
                                targetIndex = rcScope.map.get(bestMatchKey);
                            } else {
                                targetIndex = global.globalNextIndex;
                                rcScope.map.set(cleanName, targetIndex);
                                rcScope.nextIndex = targetIndex + 1;
                                global.globalNextIndex++;
                                rcScope.needsSave = true;
                            }
                        }

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

                    dbResult.dynamic_root_causes = dbDynamicRootCauses;

                    let hasLabs = false;
                    let validLabs = [];
                    if (dt.labs && Array.isArray(dt.labs)) {
                        for (const lab of dt.labs) {
                            if (lab.type) {
                                hasLabs = true;
                                let labType = lab.type === 'urinary_albumin_to_creatinine_ratio' ? 'uacr' : lab.type;
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

                    if (dbResult.diseases_rate_all_null === 0) {
                        dbResult.disease_rate_combination = 0;
                    } else {
                        dbResult.disease_rate_combination = dbResult.disease_rates;
                    }

                    articleDbResults.push(dbResult);
                }
            }
            return articleDbResults;
        });

        const batchResults = await Promise.all(batchPromises);

        for (const resList of batchResults) {
            if (Array.isArray(resList)) {
                recordsToInsert.push(...resList);
            }
        }

        if (deletedRecordIds.length > 0) {
            await ResearchResult.destroy({ where: { id: deletedRecordIds } });
        }

        if (recordsToInsert.length > 0) {
            await ResearchResult.bulkCreate(recordsToInsert);
            console.log(`   ✅ DB Inserted ${recordsToInsert.length} replacement rows for batch.`);
        }
    }

    console.log(`\n======================================================`);
    console.log(`📊 RETRY STATISTICS SUMMARY`);
    console.log(`======================================================`);
    console.log(`✅ Total Success: ${totalSuccess}`);
    console.log(`❌ Total Failed to Fetch Summary: ${totalFailedFetch}`);
    console.log(`❌ Total Failed to Parse JSON: ${totalFailedParse}`);
    console.log(`⚠️ Total Returned Empty Array: ${totalFailedEmpty}`);
    console.log(`======================================================\n`);

    // Save mappings persistence
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

    console.log(`\n🎉 All AI Retries Processed! Proceeding to Post-Processing for the affected diseases...`);
    for (const [dId, dName] of affectedDiseases.entries()) {
        await runPostProcessing(dId, dName);
    }

    console.log("\n🎊 Task Completed Successfully.");
}

if (require.main === module) {
    main().catch(console.error).finally(() => sequelize.close());
}
