/**
 * 🚀 Standalone Concurrency Benchmark for Ollama & Qwen2.5-Coder:7b
 * 
 * This script runs 100 article extractions (or a customizable number) concurrently 
 * to benchmark your local Ollama server's performance, speed, and parsing success rate.
 * 
 * 📊 Features:
 * - Load real articles from the local CSV 'all diseases/Diabetes_Mellitus_Type_2_ready_articles.csv'.
 * - Prefetch all article data (abstracts/PMC full texts) in bulk from NCBI to prevent network bottlenecks.
 * - Run extractions concurrently using a custom highly stable promise pool.
 * - Calculate throughput (articles/min), average time, and JSON parsing success rate.
 * - Saves results to 'ollama_benchmark_results.json'.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { preFetchBatchArticles } = require('./getContent');

// ==================== CONFIGURATION ====================
const LIMIT_ARTICLES = 100;     // Number of articles to benchmark (Change to 10 or 20 for a quick test!)
const CONCURRENCY = 4;          // Number of parallel requests to Ollama (1, 2, or 3 depending on VRAM)
const OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_MODEL = 'mistral-small3.2';
// =======================================================

// Native stable concurrency pool to avoid CommonJS/ESM package dependency issues
async function runWithConcurrency(tasks, limit, workerFn) {
    const results = [];
    const executing = [];

    for (const task of tasks) {
        const p = Promise.resolve().then(() => workerFn(task));
        results.push(p);

        if (limit <= tasks.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);

            if (executing.length >= limit) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(results);
}

// Robust CSV parser to extract PMIDs and titles from local CSV
function parseArticlesCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());

    const pmidIndex = headers.indexOf('PMID');
    const pubmedIndex = headers.indexOf('pubmed');
    const titleIndex = headers.indexOf('title');
    const rateIndex = headers.indexOf('rate');

    const articles = [];
    const uniquePmids = new Set();

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Split ignoring commas inside quotes
        const parts = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        const values = parts.map(p => p.replace(/^"|"$/g, '').trim());

        const pmid = values[pmidIndex];
        if (pmid && !uniquePmids.has(pmid)) {
            uniquePmids.add(pmid);
            articles.push({
                PMID: pmid,
                pubmed: values[pubmedIndex] || `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
                title: values[titleIndex] || "No Title",
                rate: parseInt(values[rateIndex]) || 0
            });
        }
    }
    return articles;
}

// JSON parsing helper
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
    if (firstBracket === -1) return null;
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

    try {
        return JSON.parse(result);
    } catch (e) {
        return null;
    }
}

async function main() {
    console.log("==================================================================");
    console.log("🚀  OLLAMA CONCURRENCY & SPEED BENCHMARK RUNNER  🚀");
    console.log("==================================================================");
    console.log(`Parameters:\n - Target Articles: ${LIMIT_ARTICLES}\n - Concurrency: ${CONCURRENCY}\n - Model: ${OLLAMA_MODEL}\n`);

    // 1. Verify connection to Ollama
    try {
        await axios.get(`${OLLAMA_BASE_URL}/api/tags`, { timeout: 3000 });
        console.log("✅ Connection to Ollama verified successfully!");
    } catch (err) {
        console.error("❌ Failed to connect to Ollama. Please make sure the Ollama application is running on port 11434.");
        process.exit(1);
    }

    // 2. Read prompt template from article.txt
    const templatePath = path.join(__dirname, 'article.txt');
    if (!fs.existsSync(templatePath)) {
        console.error("❌ 'article.txt' template not found in the workspace directory. Cannot proceed.");
        process.exit(1);
    }
    const template = fs.readFileSync(templatePath, 'utf-8');
    const inputIndex = template.indexOf('Input\n');
    const taskIndex = template.indexOf('\nTask');

    if (inputIndex === -1 || taskIndex === -1) {
        console.error("❌ 'article.txt' template does not have the expected Input/Task structure.");
        process.exit(1);
    }

    const prefix = template.substring(0, inputIndex + 6);
    const suffix = template.substring(taskIndex);

    function buildPrompt(title, abstract, body) {
        const MAX_BODY_LENGTH = 15000;
        const truncatedBody = body.length > MAX_BODY_LENGTH ? body.substring(0, MAX_BODY_LENGTH) + "\n...[TRUNCATED]" : body;
        const cleanText = `Title: ${title}\n\nAbstract: ${abstract}\n\nBody:\n${truncatedBody}`.trim();
        return `${prefix}\n${cleanText}\n${suffix}`;
    }

    // 3. Load articles from CSV
    const csvPath = path.join(__dirname, 'all diseases', 'Diabetes_Mellitus_Type_2_ready_articles.csv');
    if (!fs.existsSync(csvPath)) {
        console.error(`❌ CSV File not found at: ${csvPath}`);
        process.exit(1);
    }

    console.log(`📖 Parsing articles list from: all diseases/Diabetes_Mellitus_Type_2_ready_articles.csv...`);
    const allArticles = parseArticlesCSV(csvPath);
    console.log(`📦 Loaded ${allArticles.length} unique articles from CSV.`);

    const selectedArticles = allArticles.slice(0, LIMIT_ARTICLES);
    console.log(`🎯 Selected first ${selectedArticles.length} articles for benchmark.`);

    // 4. Prefetch all article data in bulk to exclude network speeds from benchmark
    console.log("\n📥 Bulk pre-fetching abstracts/full texts from NCBI... (This takes a few seconds)");
    let preFetchedData = {};
    try {
        preFetchedData = await preFetchBatchArticles(selectedArticles);
        console.log(`✅ Bulk pre-fetching complete! Fetched texts for ${Object.keys(preFetchedData).length}/${selectedArticles.length} articles.`);
    } catch (err) {
        console.error(`❌ Error during bulk pre-fetching: ${err.message}`);
        console.log("⚠️ Will try to fetch articles dynamically if missing.");
    }

    // 5. Run benchmark
    console.log(`\n🚦 Starting Benchmark Pipeline with Concurrency Level: ${CONCURRENCY}...`);
    console.log("==================================================================");

    const startTime = Date.now();
    let completedCount = 0;
    let successCount = 0;
    let totalInferenceTime = 0;
    const finalResults = [];

    const tasks = selectedArticles.map((article, idx) => ({ article, index: idx + 1 }));

    await runWithConcurrency(tasks, CONCURRENCY, async ({ article, index }) => {
        const pmid = article.PMID;
        const content = preFetchedData[pmid] || { title: article.title, abstract: "", body: "" };

        if (!content.abstract && !content.body) {
            console.log(`[Progress: ${index}/${LIMIT_ARTICLES}] ⚠️ Skipping PMID ${pmid} - No content fetched.`);
            completedCount++;
            return;
        }

        const promptContent = buildPrompt(content.title, content.abstract, content.body);
        const taskStartTime = Date.now();

        try {
            const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
                model: OLLAMA_MODEL,
                messages: [{ role: 'user', content: promptContent }],
                options: { temperature: 0.1 },
                stream: false
            }, {
                timeout: 180000 // 3 minutes timeout limit
            });

            const duration = (Date.now() - taskStartTime) / 1000;
            totalInferenceTime += duration;
            completedCount++;

            const rawContent = response.data.message?.content || "";
            const parsedJSON = extractJSONArray(rawContent);

            let status = "❌ FAILED (Invalid JSON)";
            if (parsedJSON) {
                status = "✅ SUCCESS (Valid JSON)";
                successCount++;
                finalResults.push({
                    PMID: pmid,
                    title: content.title,
                    data: parsedJSON
                });
            }

            const averageTime = (totalInferenceTime / completedCount).toFixed(1);
            console.log(`[Progress: ${completedCount}/${LIMIT_ARTICLES}] PMID ${pmid} processed in ${duration.toFixed(1)}s. ${status}. (Running average: ${averageTime}s)`);

        } catch (err) {
            completedCount++;
            console.error(`[Progress: ${completedCount}/${LIMIT_ARTICLES}] ❌ Error processing PMID ${pmid}: ${err.message}`);
        }
    });

    const totalDuration = (Date.now() - startTime) / 1000;
    const minutes = Math.floor(totalDuration / 60);
    const seconds = (totalDuration % 60).toFixed(1);

    const throughput = (completedCount / (totalDuration / 60)).toFixed(2);
    const overallAverage = completedCount > 0 ? (totalDuration / completedCount).toFixed(1) : 0;
    const parseRate = completedCount > 0 ? ((successCount / completedCount) * 100).toFixed(1) : 0;

    console.log("\n==================================================================");
    console.log("🏁  BENCHMARK SUMMARY REPORT  🏁");
    console.log("==================================================================");
    console.log(`⏱️ Total Time Elapsed: ${minutes}m ${seconds}s (${totalDuration.toFixed(1)} seconds)`);
    console.log(`📥 Total Articles Processed: ${completedCount}`);
    console.log(`🚀 Concurrency Level Tested: ${CONCURRENCY}`);
    console.log(`⚡ Average processing time per article: ${overallAverage}s`);
    console.log(`📈 Throughput Rate: ${throughput} articles/minute`);
    console.log(`🎯 JSON Extraction Success Rate: ${parseRate}% (${successCount}/${completedCount} parsed)`);
    console.log("==================================================================");

    // Save results
    const outputPath = path.join(__dirname, 'ollama_benchmark_results.json');
    fs.writeFileSync(outputPath, JSON.stringify(finalResults, null, 2), 'utf-8');
    console.log(`💾 All benchmarked extractions successfully saved to: ${path.basename(outputPath)}`);
    console.log("==================================================================");
}

main();
