
require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { Parser } = require("json2csv");
const { getURL } = require("./getURL");
const { sequelize } = require("./models/all");

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
    return name.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
}

function generateQueries(productMesh, diseaseMesh) {
    const q1 = `("${productMesh}"[Mesh] AND "${productMesh}/therapeutic use"[Mesh] NOT "${productMesh}/adverse effects"[Mesh]) AND ("${diseaseMesh}/diet therapy"[Mesh] OR "${diseaseMesh}/drug therapy"[Mesh] OR "${diseaseMesh}/prevention and control"[Mesh] OR "${diseaseMesh}/rehabilitation"[Mesh] OR "${diseaseMesh}/therapy"[Mesh])`;

    const q2 = `("${productMesh}"[Mesh] NOT "${productMesh}/adverse effects"[Mesh]) AND ("${diseaseMesh}/diet therapy"[Mesh] OR "${diseaseMesh}/drug therapy"[Mesh] OR "${diseaseMesh}/prevention and control"[Mesh] OR "${diseaseMesh}/rehabilitation"[Mesh] OR "${diseaseMesh}/therapy"[Mesh])`;

    const q3 = `("${productMesh}" NOT "${productMesh}/adverse effects") AND ("${diseaseMesh}/diet therapy" OR "${diseaseMesh}/drug therapy" OR "${diseaseMesh}/prevention and control" OR "${diseaseMesh}/rehabilitation" OR "${diseaseMesh}/therapy")`;

    return { q1, q2, q3 };
}

async function searchPubMed(query) {
    try {
        const url = `${NCBI_SEARCH_URL}?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&api_key=${API_KEY}`;
        const res = await axios.get(url);
        const total = parseInt(res.data.esearchresult.count);

        if (!total || total === 0) return [];

        const fullUrl = `${url}&retmax=${total}`;
        const fullRes = await axios.get(fullUrl);
        return fullRes.data.esearchresult.idlist || [];
    } catch (error) {
        return [];
    }
}

async function fetchArticleDetails(articleIds) {
    const allDetails = [];

    const fetchBatch = async (batchIds) => {
        const url = `${NCBI_DETAIL_URL}?db=pubmed&id=${batchIds.join(",")}&retmode=json&api_key=${API_KEY}`;
        const res = await axios.get(url);
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
                    PMID: id || null, // Added Raw PMID
                    doi: doiEntry ? `https://doi.org/${doiEntry.value}` : "No DOI available",
                    DOI: doiEntry ? doiEntry.value : null, // Added Raw DOI
                    pmc: pmcEntry ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcEntry.value}/` : "No PMC available",
                    PMCID: pmcEntry ? pmcEntry.value : null, // Added Raw PMC
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
        await new Promise(res => setTimeout(res, 100)); // Optimized to 100ms for API_KEY limit
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

async function processItem(item, disease, index, total) {
    console.log(`  [${index + 1}/${total}] Product ID ${item.id}: ${item.Root}`);

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
        'id',
        'root_name',
        'disease_id',
        'disease_name',
        'odw',
        'best_mesh_match',
        'query_used',
        'articles_count',
        'calculated_dw',
        'category',
        'q1',
        'q2',
        'q3'
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
            'item_id',
            'root_name',
            'disease_id',
            'disease_name',
            'articles_count',
            'category',
            'calculated_dw',
            'article_number',
            'title',
            'authors',
            'pubmed',
            'PMID',
            'doi',
            'DOI',
            'pmc',
            'PMCID',
            'pubtypes',
            'rate'
        ];

        const articlesParser = new Parser({ fields: articlesFields });
        const articlesCsv = articlesParser.parse(allArticles);
        fs.writeFileSync(path.join(outputDir, `${filename}_articles.csv`), articlesCsv, 'utf-8');
    }
}

async function processDisease(disease, products, diseaseIndex, totalDiseases) {
    console.log(`\n[${diseaseIndex + 1}/${totalDiseases}] Processing Disease ID ${disease.id}: ${disease["Best MeSH"]}`);
    console.log(`Articles threshold: ${ARTICLES_THRESHOLD}`);

    const results = [];
    const allProductNames = products.map(p => p.Root).filter(Boolean).join(", ");

    for (let i = 0; i < products.length; i++) {
        const product = products[i];

        try {
            const result = await processItem(product, disease, i, products.length);

            if (result !== null) {
                result.all_product_names = allProductNames;
                results.push(result);
                if (result.category !== "ready") {
                    console.log(`    Skipping AI processing for ${product.Root} - Not ready`);
                }
            }

            await new Promise(res => setTimeout(res, 2000));

        } catch (error) {
            console.log(`    Error: ${error.message}`);
        }
    }

    const readyItems = results.filter(r => r.category === "ready");
    const notReadyItems = results.filter(r => r.category === "not_ready");

    console.log(`\nDisease ${disease["Best MeSH"]} Summary:`);
    console.log(`  Total products: ${results.length}`);
    console.log(`  Ready (Articles <= ${ARTICLES_THRESHOLD}): ${readyItems.length}`);
    console.log(`  Not ready (Articles > ${ARTICLES_THRESHOLD}): ${notReadyItems.length}`);

    const diseaseName = sanitizeFilename(disease["Best MeSH"]);

    try {
        console.log(`\nSaving files for ${disease["Best MeSH"]}...`);
        saveToCSV(results, `${diseaseName}_all`, OUTPUT_DIR);
        saveToCSV(readyItems, `${diseaseName}_ready`, OUTPUT_DIR);
        saveToCSV(notReadyItems, `${diseaseName}_not_ready`, OUTPUT_DIR);

        fs.writeFileSync(
            path.join(OUTPUT_DIR, `${diseaseName}_output.json`),
            JSON.stringify(results, null, 2)
        );

        console.log(`Files saved for ${disease["Best MeSH"]}`);
    } catch (fileErr) {
        console.error(`❌ Error saving files for ${disease["Best MeSH"]}:`, fileErr.message);
    } finally {
        if (readyItems.length > 0) {
            console.log(`\n⏳ Running AI tasks sequentially for ${readyItems.length} ready products to prevent rate limits...`);
            await getURL(readyItems);
            console.log(`✅ All AI tasks for disease ${disease["Best MeSH"]} completed.`);
        }
    }

    console.log(`🔄 Updating records with missing item_name for disease ${disease["Best MeSH"]}...`);
    try {
        const { Op } = require("sequelize");
        const { ResearchResult } = require("./models/all");

        const recordsToUpdate = await ResearchResult.findAll({
            where: {
                diseaseId: disease.id,
                root_name: {
                    [Op.and]: [
                        { [Op.not]: null },
                        { [Op.not]: '' },
                        { [Op.notILike]: 'null' },
                        { [Op.notILike]: 'not mentioned' }
                    ]
                }
            },
            order: [
                ['productId', 'ASC'],
                ['article_number', 'ASC']
            ]
        });

        // 1. Pre-compile Regexes outside the loop to avoid severe performance overhead
        const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const precompiledResults = results.map(res => {
            const rootName = res.root_name.toLowerCase();
            const bestMesh = res.best_mesh_match ? res.best_mesh_match.toLowerCase() : null;
            return {
                ...res,
                rootRegex: new RegExp('\\b' + escapeRegExp(rootName) + '\\b', 'i'),
                meshRegex: bestMesh ? new RegExp('\\b' + escapeRegExp(bestMesh) + '\\b', 'i') : null
            };
        });

        // 2. Use Array of promises for concurrent execution (Huge speed boost)
        const updatePromises = [];
        let updateCount = 0;

        for (const record of recordsToUpdate) {
            const foundMatch = precompiledResults.find(res =>
                res.rootRegex.test(record.root_name) ||
                (res.meshRegex && res.meshRegex.test(record.root_name))
            );

            if (foundMatch) {
                // Only update IDs and name, as counts will be recalculated immediately below
                updatePromises.push(record.update({
                    productId: foundMatch.id,
                    root_name: foundMatch.root_name
                }));
            } else {
                updatePromises.push(record.update({
                    productId: 0,
                    root_name: record.root_name,
                    calculated_dw: 0,
                    articles_count: 0
                }));
            }
            updateCount++;
        }

        await Promise.all(updatePromises);
        console.log(`✅ Updated ${updateCount} records with mapped item_name.`);

        // Recalculate dw, articles_count, article_number, category for all products in this disease
        console.log(`🔄 Recalculating DW and counts for all products in disease ${disease["Best MeSH"]}...`);
        const allRecordsInDisease = await ResearchResult.findAll({
            where: { diseaseId: disease.id },
            order: [
                ['productId', 'ASC'],
                ['article_number', 'ASC']
            ]
        });

        const groupMap = new Map();
        for (const record of allRecordsInDisease) {
            const pid = record.productId;
            if (!pid || pid === 0) continue;
            if (!groupMap.has(pid)) groupMap.set(pid, []);
            groupMap.get(pid).push(record);
        }

        let recalcUpdates = 0;
        const recalcPromises = []; // Store recalculation promises

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

            const rates = uniqueArticles.map(a => a.rate === 0 ? 1 : a.rate);
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
        console.log(`✅ Recalculated DW and counts updated ${recalcUpdates} records.`);

        // Physically sort the database rows by recreating them
        console.log(`🔄 Physically sorting the rows in the database for disease ${disease["Best MeSH"]}...`);
        const finalSortedRecords = await ResearchResult.findAll({
            where: { diseaseId: disease.id },
            order: [
                ['productId', 'ASC'],
                [sequelize.literal('NULLIF("article_number", \'\')::INTEGER'), 'ASC']
            ],
            raw: true
        });

        if (finalSortedRecords.length > 0) {
            await ResearchResult.destroy({ where: { diseaseId: disease.id } });
            const recordsToInsert = finalSortedRecords.map(r => {
                delete r.id; // Allow DB to auto-generate a fresh, sorted ID
                return r;
            });
            await ResearchResult.bulkCreate(recordsToInsert);
            console.log(`✅ Disease ${disease["Best MeSH"]} database rows physically sorted.`);
        }

    } catch (err) {
        console.error("❌ Error updating records post-disease:", err);
    }
}

async function main() {
    console.log("Starting processing: ALL diseases x ALL products");
    console.log("");

    const diseases = JSON.parse(fs.readFileSync("diseases_msh-2.json", "utf-8"));
    const products = JSON.parse(fs.readFileSync("roots-data.json", "utf-8"));

    console.log(`Loaded ${diseases.length} diseases`);
    console.log(`Loaded ${products.length} products`);
    console.log("");

    try {
        // Authenticate and sync DB before processing
        await sequelize.authenticate();
        console.log("✅ Connected to DB");
        await sequelize.sync({ alter: true });
        console.log("📦 Tables synced");

        for (let i = 0; i < diseases.length; i++) {
            await processDisease(diseases[i], products, i, diseases.length);
        }

    } catch (error) {
        console.error("❌ Database or Processing Error:", error);
    } finally {
        await sequelize.close();
    }

    console.log("\n" + "=".repeat(60));
    console.log("All diseases processed successfully");
    console.log("=".repeat(60));
}

main();
