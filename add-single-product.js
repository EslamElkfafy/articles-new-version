require("dotenv").config();
const axios = require("axios");
const fs = require("fs");

async function axiosGetWithRetry(url, options = {}, retries = 3, delay = 2000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await axios.get(url, options);
        } catch (error) {
            const isTimeout = error.code === 'ECONNABORTED' || error.message.includes('timeout') || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND' || error.code === 'ECONNRESET';
            const isTransient = error.response && (error.response.status === 429 || error.response.status >= 500);
            
            if ((isTimeout || isTransient) && attempt < retries) {
                console.warn(`    ⚠️ Network warning: ${error.message}. Retrying request (Attempt ${attempt}/${retries}) in ${delay * attempt / 1000}s...`);
                await new Promise(res => setTimeout(res, delay * attempt));
                continue;
            }
            throw error;
        }
    }
}
const path = require("path");
const { Parser } = require("json2csv");
const { getURL } = require("./getURL");
const { sequelize } = require("./models/all");

// Helper to normalize plurals to singular forms
function getSingularForm(word) {
    if (!word) return "";
    let clean = word.toLowerCase().trim();
    if (clean.endsWith('ies')) {
        return clean.slice(0, -3) + 'y';
    }
    if (clean.endsWith('es')) {
        const stem = clean.slice(0, -2);
        if (stem.endsWith('ch') || stem.endsWith('sh') || stem.endsWith('x') || stem.endsWith('s') || stem.endsWith('z') || stem.endsWith('o')) {
            return stem;
        }
        if (clean.endsWith('s')) {
            return clean.slice(0, -1);
        }
    }
    if (clean.endsWith('s') && !clean.endsWith('ss')) {
        return clean.slice(0, -1);
    }
    return clean;
}

// Helper to check if two names are similar (matching singular forms or one contains the other as a whole word)
function isSimilar(name1, name2) {
    if (!name1 || !name2) return false;
    const s1 = getSingularForm(name1);
    const s2 = getSingularForm(name2);
    
    if (s1 === s2) return true;

    const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRegex = (word) => new RegExp('\\b' + escapeRegExp(word) + '\\b', 'i');
    
    const r1 = wordRegex(s2);
    const r2 = wordRegex(s1);
    
    return r1.test(s1) || r2.test(s2);
}

const NCBI_SEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const NCBI_DETAIL_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";
const API_KEY = "b587f1cf996207071196b22c8418b7259607";
const MAX_ARTICLES = 100;
const ARTICLES_THRESHOLD = 173;
const OUTPUT_DIR = "all diseases";

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

function sanitizeFilename(name) {
    if (!name) return "unknown";
    return name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
}

function generateQueries(productMesh, diseaseMesh) {
    const q1 = `("${productMesh}"[Mesh] AND "${productMesh}/therapeutic use"[Mesh] NOT "${productMesh}/adverse effects"[Mesh]) AND ("${diseaseMesh}/diet therapy"[Mesh] OR "${diseaseMesh}/drug therapy"[Mesh] OR "${diseaseMesh}/prevention and control"[Mesh] OR "${diseaseMesh}/rehabilitation"[Mesh] OR "${diseaseMesh}/therapy"[Mesh])`;
    const q2 = `("${productMesh}"[Mesh] NOT "${productMesh}/adverse effects"[Mesh]) AND ("${diseaseMesh}/diet therapy"[Mesh] OR "${diseaseMesh}/drug therapy"[Mesh] OR "${diseaseMesh}/prevention and control"[Mesh] OR "${diseaseMesh}/rehabilitation"[Mesh] OR "${diseaseMesh}/therapy"[Mesh])`;
    const q3 = `("${productMesh}" NOT "adverse effects"[Subheading]) AND ("${diseaseMesh}/diet therapy" OR "${diseaseMesh}/drug therapy" OR "${diseaseMesh}/prevention and control" OR "${diseaseMesh}/rehabilitation" OR "${diseaseMesh}/therapy")`;
    return { q1, q2, q3 };
}

async function searchPubMed(query) {
    try {
        const url = `${NCBI_SEARCH_URL}?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&api_key=${API_KEY}`;
        const res = await axiosGetWithRetry(url);
        const total = parseInt(res.data.esearchresult.count);

        if (!total || total === 0) return [];

        const fullUrl = `${url}&retmax=${total}`;
        const fullRes = await axiosGetWithRetry(fullUrl);
        return fullRes.data.esearchresult.idlist || [];
    } catch (error) {
        console.warn(`    ⚠️ PubMed search failed: ${error.message} (Query: ${query.substring(0, 60)}...)`);
        return [];
    }
}

async function fetchArticleDetails(articleIds) {
    const allDetails = [];

    const fetchBatch = async (batchIds) => {
        const url = `${NCBI_DETAIL_URL}?db=pubmed&id=${batchIds.join(",")}&retmode=json&api_key=${API_KEY}`;
        const res = await axiosGetWithRetry(url);
        const result = res.data.result;

        const articles = Object.keys(result)
            .filter(key => key !== "uids")
            .map(id => {
                const article = result[id];
                const doiEntry = article.articleids?.find(a => a.idtype === "doi");
                const pmcEntry = article.articleids?.find(a => a.idtype === "pmc");
                const pubtypes = article.pubtype || ["No publication type"];

                const highestRate = pubtypes.reduce((maxRate, currentType) => {
                    const rate = pubTypeRates[currentType] || 0;
                    return rate > maxRate ? rate : maxRate;
                }, 0);

                return {
                    title: article.title || "Unknown Title",
                    authors: article.authors ? article.authors.map(a => a.name).join(", ") : "No Authors",
                    pubmed: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
                    PMID: id || null,
                    doi: doiEntry ? `https://doi.org/${doiEntry.value}` : "No DOI available",
                    DOI: doiEntry ? doiEntry.value : null,
                    pmc: pmcEntry ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcEntry.value}/` : "No PMC available",
                    PMCID: pmcEntry ? pmcEntry.value : null,
                    pubtypes: pubtypes.join(", "),
                    rate: highestRate,
                };
            });

        allDetails.push(...articles);
    };

    const batches = [];
    for (let i = 0; i < articleIds.length; i += MAX_ARTICLES) {
        batches.push(articleIds.slice(i, i + MAX_ARTICLES));
    }

    for (const batch of batches) {
        await fetchBatch(batch);
        await new Promise(res => setTimeout(res, 100));
    }

    return allDetails;
}

function calculateDW(articles) {
    if (articles.length === 0) return 0;
    const rates = articles.map(a => a.rate === 0 ? 1 : a.rate);
    const sum = rates.reduce((a, b) => a + b, 0);
    const max = Math.max(...rates);
    return sum * max;
}

async function processItem(item, disease) {
    console.log(`  Processing Product ID ${item.id}: ${item.Root}`);

    if (!item["Best MeSH match"]) {
        console.log(`    Skipped: Missing MeSH`);
        return null;
    }

    const queries = generateQueries(item["Best MeSH match"], disease["Best MeSH"]);

    const queryList = [
        { name: "Q1", query: queries.q1 },
        { name: "Q2", query: queries.q2 },
        { name: "Q3", query: queries.q3 }
    ];

    for (const { name, query } of queryList) {
        const articleIds = await searchPubMed(query);

        if (articleIds.length > 0) {
            const articles = await fetchArticleDetails(articleIds);
            articles.sort((a, b) => b.rate - a.rate);
            const dw = calculateDW(articles);
            console.log(`    Query: ${name}, Articles: ${articles.length}, DW: ${dw}`);

            return {
                id: item.id,
                root_name: item.Root,
                disease_id: disease.id,
                disease_name: disease["Best MeSH"],
                odw: item.odw,
                best_mesh_match: item["Best MeSH match"],
                query_used: name,
                articles_count: articles.length,
                calculated_dw: dw,
                category: articles.length <= ARTICLES_THRESHOLD ? "ready" : "not_ready",
                q1: queries.q1,
                q2: queries.q2,
                q3: queries.q3,
                articles: articles
            };
        }
    }

    console.log(`    No articles found`);

    return {
        id: item.id,
        root_name: item.Root,
        disease_id: disease.id,
        disease_name: disease["Best MeSH"],
        odw: item.odw,
        best_mesh_match: item["Best MeSH match"],
        query_used: "None",
        articles_count: 0,
        calculated_dw: 0,
        category: "ready",
        q1: queries.q1,
        q2: queries.q2,
        q3: queries.q3,
        articles: []
    };
}

function saveToCSV(data, filename, outputDir) {
    const mainData = data.map(item => {
        const { articles, ...mainItem } = item;
        return mainItem;
    });

    const mainFields = [
        'id', 'root_name', 'disease_id', 'disease_name', 'odw',
        'best_mesh_match', 'query_used', 'articles_count',
        'calculated_dw', 'category', 'q1', 'q2', 'q3'
    ];

    const mainParser = new Parser({ fields: mainFields });
    const mainCsv = mainParser.parse(mainData);
    fs.writeFileSync(path.join(outputDir, `${filename}_main.csv`), mainCsv, 'utf-8');

    const allArticles = [];
    data.forEach(item => {
        if (item.articles && item.articles.length > 0) {
            item.articles.forEach((article, index) => {
                allArticles.push({
                    item_id: item.id,
                    root_name: item.root_name,
                    disease_id: item.disease_id,
                    disease_name: item.disease_name,
                    articles_count: item.articles_count,
                    category: item.category,
                    calculated_dw: item.calculated_dw,
                    article_number: index + 1,
                    title: article.title,
                    authors: article.authors,
                    pubmed: article.pubmed,
                    PMID: article.PMID,
                    doi: article.doi,
                    DOI: article.DOI,
                    pmc: article.pmc,
                    PMCID: article.PMCID,
                    pubtypes: article.pubtypes,
                    rate: article.rate
                });
            });
        }
    });

    if (allArticles.length > 0) {
        const articlesFields = [
            'item_id', 'root_name', 'disease_id', 'disease_name',
            'articles_count', 'category', 'calculated_dw', 'article_number',
            'title', 'authors', 'pubmed', 'PMID', 'doi', 'DOI',
            'pmc', 'PMCID', 'pubtypes', 'rate'
        ];

        const articlesParser = new Parser({ fields: articlesFields });
        const articlesCsv = articlesParser.parse(allArticles);
        fs.writeFileSync(path.join(outputDir, `${filename}_articles.csv`), articlesCsv, 'utf-8');
    }
}

async function updateDatabase(disease, productResult) {
    try {
        const { Op } = require("sequelize");
        const { ResearchResult } = require("./models/all");

        // The productResult already has articles processed via getURL in the main loop
        // We will just physical sort in the DB if needed for this disease, 
        // though running getURL() inserts/updates records.
        
        console.log(`🔄 Updating records and recalculating for ${productResult.root_name} in disease ${disease["Best MeSH"]}...`);
        
        const allRecordsForProductInDisease = await ResearchResult.findAll({
            where: { diseaseId: disease.id, productId: productResult.id },
            order: [
                ['productId', 'ASC'],
                ['article_number', 'ASC']
            ]
        });

        const uniqueArticlesMap = new Map();
        for (const record of allRecordsForProductInDisease) {
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

        const rates = uniqueArticles.map(a => a.rate || 0);
        let calculated_dw = 0;
        if (rates.length > 0) {
            const sum = rates.reduce((a, b) => a + b, 0);
            const max = Math.max(...rates);
            calculated_dw = sum * max;
        }

        uniqueArticles.sort((a, b) => b.rate - a.rate);

        const recalcPromises = [];
        let recalcUpdates = 0;

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

        await Promise.all(recalcPromises);
        console.log(`✅ Recalculated DW and counts updated ${recalcUpdates} records.`);

    } catch (err) {
        console.error("❌ Error updating database records:", err);
    }
}

async function preSearchDisease(item, disease) {
    if (!item["Best MeSH match"] || !disease["Best MeSH"]) return null;
    const queries = generateQueries(item["Best MeSH match"], disease["Best MeSH"]);
    const queryList = [
        { name: "Q1", query: queries.q1 },
        { name: "Q2", query: queries.q2 },
        { name: "Q3", query: queries.q3 }
    ];
    for (const { name, query } of queryList) {
        try {
            const articleIds = await searchPubMed(query);
            if (articleIds.length > 0) {
                return { disease, matchedQuery: name, articleIds, queries };
            }
        } catch (error) {
            // Ignore error
        }
    }
    return null;
}

async function processSingleProduct(newProduct, runSync = false, runClose = false) {
    const { Item } = require("./models/all");
    
    // Register active run
    global.activeSingleProductRuns = global.activeSingleProductRuns || new Map();
    global.activeSingleProductRuns.set(String(newProduct.id), { stopRequested: false });

    // Update status to Processing
    await Item.update(
        { processing_status: 'Processing' },
        { where: { id: parseInt(newProduct.id, 10) } }
    );

    const diseases = JSON.parse(fs.readFileSync(path.join(__dirname, "diseases_msh-2.json"), "utf-8"));

    try {
        if (runSync) {
            await sequelize.authenticate();
            await sequelize.sync({ alter: true });
        }

        if (!fs.existsSync(OUTPUT_DIR)){
            fs.mkdirSync(OUTPUT_DIR);
        }

        console.log(`🔍 Pre-searching PubMed for all ${diseases.length} diseases...`);
        const activeDiseases = [];
        const emptyDiseases = [];
        
        for (let i = 0; i < diseases.length; i++) {
            // Check if stop requested
            if (global.activeSingleProductRuns && global.activeSingleProductRuns.get(String(newProduct.id))?.stopRequested) {
                console.log(`🛑 Process stopped for Product ${newProduct.Root} by user request.`);
                await Item.update(
                    { processing_status: 'Failed' },
                    { where: { id: parseInt(newProduct.id, 10) } }
                ).catch(dbErr => console.error("Error setting status to Failed on stop:", dbErr.message));
                return;
            }

            const disease = diseases[i];
            const searchResult = await preSearchDisease(newProduct, disease);
            if (searchResult) {
                activeDiseases.push(searchResult);
            } else {
                emptyDiseases.push(disease);
            }
            
            // Respect NCBI rate limit (10 requests/sec with API key)
            // 150ms delay between diseases ensures we stay well below the limit
            await new Promise(res => setTimeout(res, 150));
        }

        console.log(`📊 Pre-search complete: ${activeDiseases.length} active diseases, ${emptyDiseases.length} empty diseases.`);

        // 1. Process empty diseases instantly in parallel
        console.log(`💾 Saving results for ${emptyDiseases.length} empty diseases...`);
        const emptyPromises = emptyDiseases.map(async (disease) => {
            const diseaseMesh = disease["Best MeSH"] || `disease_${disease.id}`;
            const queries = (newProduct["Best MeSH match"] && disease["Best MeSH"]) ? generateQueries(newProduct["Best MeSH match"], disease["Best MeSH"]) : { q1: "", q2: "", q3: "" };
            const emptyResult = {
                id: newProduct.id,
                root_name: newProduct.Root,
                disease_id: disease.id,
                disease_name: diseaseMesh,
                odw: newProduct.odw,
                best_mesh_match: newProduct["Best MeSH match"],
                query_used: "None",
                articles_count: 0,
                calculated_dw: 0,
                category: "not_ready",
                q1: queries.q1,
                q2: queries.q2,
                q3: queries.q3,
                articles: [],
                all_product_names: newProduct.Root
            };

            const diseaseName = sanitizeFilename(diseaseMesh);
            const results = [emptyResult];
            saveToCSV(results, `SingleProduct_${newProduct.Root}_${diseaseName}_all`, OUTPUT_DIR);
            fs.writeFileSync(
                path.join(OUTPUT_DIR, `SingleProduct_${newProduct.Root}_${diseaseName}_output.json`),
                JSON.stringify(results, null, 2)
            );
            await updateDatabase(disease, emptyResult);
        });
        await Promise.all(emptyPromises);

        // 2. Process active diseases sequentially (with AI and delay)
        console.log(`🚀 Processing ${activeDiseases.length} active diseases sequentially...`);
        for (let i = 0; i < activeDiseases.length; i++) {
            const { disease, matchedQuery, articleIds, queries } = activeDiseases[i];
            
            // Check if stop requested
            if (global.activeSingleProductRuns && global.activeSingleProductRuns.get(String(newProduct.id))?.stopRequested) {
                console.log(`🛑 Process stopped for Product ${newProduct.Root} by user request.`);
                await Item.update(
                    { processing_status: 'Failed' },
                    { where: { id: parseInt(newProduct.id, 10) } }
                ).catch(dbErr => console.error("Error setting status to Failed on stop:", dbErr.message));
                return;
            }

            console.log(`\n[${i + 1}/${activeDiseases.length}] Fetching and analyzing articles for Disease ID ${disease.id}: ${disease["Best MeSH"]}`);
            
            try {
                const articles = await fetchArticleDetails(articleIds);
                articles.sort((a, b) => b.rate - a.rate);
                const dw = calculateDW(articles);
                console.log(`    Query: ${matchedQuery}, Articles: ${articles.length}, DW: ${dw}`);

                const result = {
                    id: newProduct.id,
                    root_name: newProduct.Root,
                    disease_id: disease.id,
                    disease_name: disease["Best MeSH"],
                    odw: newProduct.odw,
                    best_mesh_match: newProduct["Best MeSH match"],
                    query_used: matchedQuery,
                    articles_count: articles.length,
                    calculated_dw: dw,
                    category: articles.length <= ARTICLES_THRESHOLD ? "ready" : "not_ready",
                    q1: queries.q1,
                    q2: queries.q2,
                    q3: queries.q3,
                    articles: articles,
                    all_product_names: newProduct.Root
                };

                const diseaseName = sanitizeFilename(disease["Best MeSH"]);
                const results = [result];
                const readyItems = result.category === "ready" ? [result] : [];

                // Save local files for tracking
                saveToCSV(results, `SingleProduct_${newProduct.Root}_${diseaseName}_all`, OUTPUT_DIR);
                fs.writeFileSync(
                    path.join(OUTPUT_DIR, `SingleProduct_${newProduct.Root}_${diseaseName}_output.json`),
                    JSON.stringify(results, null, 2)
                );
                
                if (readyItems.length > 0) {
                    console.log(`\n⏳ Running AI task for ready product ${newProduct.Root}...`);
                    await getURL(readyItems);
                    console.log(`✅ AI task for disease ${disease["Best MeSH"]} completed.`);
                } else {
                    console.log(`    Skipping AI processing for ${newProduct.Root} - Not ready`);
                }
                
                await updateDatabase(disease, result);

                // Wait only between active diseases
                if (i < activeDiseases.length - 1) {
                    await new Promise(res => setTimeout(res, 2000));
                }

            } catch (error) {
                console.log(`    Error processing disease ${disease["Best MeSH"]}: ${error.message}`);
            }
        }

        // Update status to Completed
        await Item.update(
            { processing_status: 'Completed' },
            { where: { id: parseInt(newProduct.id, 10) } }
        );
        console.log(`\n✅ All diseases processed successfully for ${newProduct.Root}`);

    } catch (error) {
        console.error("❌ Database or Processing Error:", error);
        // Update status to Failed
        await Item.update(
            { processing_status: 'Failed' },
            { where: { id: parseInt(newProduct.id, 10) } }
        ).catch(dbErr => console.error("Error setting status to Failed:", dbErr.message));
        throw error;
    } finally {
        if (global.activeSingleProductRuns) {
            global.activeSingleProductRuns.delete(String(newProduct.id));
        }
        if (runClose) {
            await sequelize.close();
        }
    }
}

async function main() {
    console.log("Starting processing for single product via CLI");
    console.log("");

    const newProductFile = "new_product.json";
    if (!fs.existsSync(newProductFile)) {
        console.error(`❌ Cannot find ${newProductFile}. Please create it first.`);
        return;
    }

    const newProduct = JSON.parse(fs.readFileSync(newProductFile, "utf-8"));
    
    // Append to roots-data.json
    const rootsDataPath = "roots-data.json";
    const rootsData = JSON.parse(fs.readFileSync(rootsDataPath, "utf-8"));
    
    const existingIndex = rootsData.findIndex(p => 
        String(p.id) === String(newProduct.id) || 
        getSingularForm(p.Root) === getSingularForm(newProduct.Root) ||
        (p["Best MeSH match"] && newProduct["Best MeSH match"] && getSingularForm(p["Best MeSH match"]) === getSingularForm(newProduct["Best MeSH match"]))
    );
    if (existingIndex !== -1) {
        console.log(`ℹ️ Product similar to '${newProduct.Root}' or MeSH match already exists in roots-data.json. Proceeding anyway.`);
    } else {
        rootsData.push(newProduct);
        fs.writeFileSync(rootsDataPath, JSON.stringify(rootsData, null, 4));
        console.log(`✅ Added '${newProduct.Root}' to roots-data.json`);
    }

    await processSingleProduct(newProduct, true, true);
}

if (require.main === module) {
    main();
}

module.exports = {
    processSingleProduct
};


