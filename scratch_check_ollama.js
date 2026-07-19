/**
 * 🛠️ Script for testing the project's prompt and extraction on a local Ollama instance running Qwen2.5-Coder:7b.
 * 
 * 📝 هذا السكربت مصمم خصيصاً لتجربة استخراج البيانات الطبية من المقالات باستخدام نموذج الجي بي تي المحلي Qwen2.5-Coder
 * المشغل عبر Ollama على جهازك.
 * 
 * 🚀 طريقة التشغيل:
 * 1. تأكد من أن برنامج Ollama يعمل على جهازك.
 * 2. تأكد من أنك قمت بتحميل النموذج عن طريق تشغيل الأمر التالي في الـ Terminal:
 *    ollama run qwen2.5-coder:7b
 * 3. قم بتشغيل هذا السكربت باستخدام Node.js:
 *    node scratch_check_ollama.js
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// إعدادات الاتصال بـ Ollama المحلي
const OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen2.5-coder:7b'; // النموذج المستهدف

/**
 * دالة قوية لتنظيف واستخراج الـ JSON من مخرجات الذكاء الاصطناعي
 * (مأخوذة ومطورة من كود المشروع الأساسي لضمان نفس الدقة)
 */
function extractJSONArray(text) {
    if (!text) return null;

    if (typeof text !== 'string') {
        if (Array.isArray(text)) return text;
        if (typeof text === 'object') return [text];
        text = String(text);
    }

    // 1. محاولة البحث عن كود الـ JSON داخل بلوكات الماركداون ```json
    const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    let content = markdownMatch ? markdownMatch[1] : text;

    // 2. إيجاد أول قوس مصفوفة [
    const firstBracket = content.indexOf('[');
    if (firstBracket === -1) {
        return null;
    }

    content = content.substring(firstBracket);

    // 3. إصلاح الـ JSON التالف أو المقطوع تلقائياً
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

        // التوقف عند اكتمال المصفوفة بالكامل خارج النصوص
        if (!inString && openBrackets === 0 && openBraces === 0 && i > 0) {
            break;
        }
    }

    if (inString) {
        result += '"';
    }

    while (openBraces > 0) {
        result += '}';
        openBraces--;
    }

    while (openBrackets > 0) {
        result += ']';
        openBrackets--;
    }

    result = result.replace(/,\s*\]/g, ']').replace(/,\s*\}/g, '}');

    try {
        return JSON.parse(result);
    } catch (e) {
        console.error("❌ [خطأ في تحليل JSON المصلح]:", e.message);
        return null;
    }
}

async function main() {
    console.log("==================================================================");
    console.log("🤖  Ollama Connection & Qwen2.5-Coder Local Test Script  🤖");
    console.log("==================================================================");

    let selectedModel = DEFAULT_MODEL;

    // 1. Check Ollama status and get downloaded models
    try {
        console.log(`📡 Connecting to Ollama at: ${OLLAMA_BASE_URL}...`);
        const tagsResponse = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, { timeout: 3000 });
        const localModels = tagsResponse.data.models || [];
        
        console.log("✅ Successfully connected to Ollama!");
        console.log("📦 Available models on your device:");
        
        const modelNames = localModels.map(m => m.name);
        modelNames.forEach(name => console.log(`   - ${name}`));

        // Check if the requested model exists or fuzzy match it
        const hasExactModel = modelNames.includes(DEFAULT_MODEL);
        const matchedModel = modelNames.find(name => name.toLowerCase().includes('qwen2.5-coder'));

        if (hasExactModel) {
            console.log(`🎯 Target model found: ${DEFAULT_MODEL}`);
            selectedModel = DEFAULT_MODEL;
        } else if (matchedModel) {
            console.log(`💡 Exact match for '${DEFAULT_MODEL}' not found, but found similar: '${matchedModel}'. Using it.`);
            selectedModel = matchedModel;
        } else {
            console.warn(`\n⚠️  Warning: Model '${DEFAULT_MODEL}' not found in your Ollama library.`);
            if (modelNames.length > 0) {
                selectedModel = modelNames[0];
                console.log(`🔄 Automatically falling back to the first available model: '${selectedModel}'`);
            } else {
                console.error("❌ No models downloaded in Ollama. Please run 'ollama pull qwen2.5-coder:7b' first.");
                process.exit(1);
            }
        }
    } catch (err) {
        console.error("\n❌ Failed to connect to Ollama!");
        console.error("💡 Please make sure the Ollama application is running on your machine.");
        console.error("🔗 Download it from: https://ollama.com");
        console.error(`Error details: ${err.message}`);
        process.exit(1);
    }

    // 2. Read prompt and sample input (article.txt)
    const articlePath = path.join(__dirname, 'article.txt');
    if (!fs.existsSync(articlePath)) {
        console.error(`\n❌ Sample article file not found at: ${articlePath}`);
        console.log("📝 Generating a dummy sample article.txt for testing...");
        fs.writeFileSync(articlePath, `Objective\nAct as a medical extractor...\nInput\nTitle: Apple pectin in diabetes\nAbstract: Apple pectin showed anti-diabetic effects by reducing blood glucose levels.\nTask\nReturn JSON array structure...`, 'utf-8');
    }

    console.log(`\n📖 Reading prompt and article from: ${path.basename(articlePath)}...`);
    const promptContent = fs.readFileSync(articlePath, 'utf-8');
    console.log(`📊 Prompt Size: ${promptContent.length} characters.`);

    // 3. Send request to Ollama
    console.log(`\n🧠 Sending request to local model '${selectedModel}'...`);
    console.log("⏳ Processing locally... This may take a while depending on your GPU/CPU speed.");
    
    const startTime = Date.now();
    try {
        const response = await axios.post(`${OLLAMA_BASE_URL}/api/chat`, {
            model: selectedModel,
            messages: [
                {
                    role: 'user',
                    content: promptContent
                }
            ],
            options: {
                temperature: 0.1 // Keep it low for deterministic JSON structures
            },
            stream: false
        }, {
            timeout: 180000 // 3 minutes timeout limit
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n✅ Model responded successfully in ${duration} seconds!`);

        const rawContent = response.data.message?.content || "";
        console.log("\n📄 [Model Raw Output - First 300 characters]:");
        console.log("------------------------------------------------------------------");
        console.log(rawContent.length > 300 ? rawContent.substring(0, 300) + "\n..." : rawContent);
        console.log("------------------------------------------------------------------");

        // 4. Try parsing the JSON
        console.log("\n🔍 Extracting and parsing JSON array...");
        const parsedJSON = extractJSONArray(rawContent);

        if (parsedJSON) {
            console.log("🎉 SUCCESS! Extracted a valid JSON array matching the required structure.");
            console.log("\n📊 [Parsed JSON Output]:");
            console.log(JSON.stringify(parsedJSON, null, 2));

            // Save result to file
            const resultPath = path.join(__dirname, 'ollama_extraction_result.json');
            fs.writeFileSync(resultPath, JSON.stringify(parsedJSON, null, 2), 'utf-8');
            console.log(`\n💾 Full result saved to: ${path.basename(resultPath)}`);
        } else {
            console.error("❌ FAILED to extract a valid JSON array from model output.");
            console.log("💡 Unfiltered raw model output for debugging:");
            console.log(rawContent);
        }

    } catch (err) {
        console.error("\n❌ Error occurred during local LLM request or processing:");
        console.error(err.message);
        if (err.code === 'ECONNABORTED') {
            console.log("💡 The local processing timed out (exceeded 3 minutes limit).");
        }
    }
}

main();
