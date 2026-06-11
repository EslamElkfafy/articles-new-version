// Load environment variables from .env file
require('dotenv').config();

// Import required libraries
const axios = require('axios'); // For making HTTP requests
const fs = require('fs'); // For file system operations
const xml2js = require('xml2js'); // For parsing XML to JSON
const extractWithAI = require('./Ai'); // Custom module for AI processing

// Configuration constants
const OUTPUT_XML_FILE = 'article.xml'; // File to store raw XML content
const OUTPUT_TEXT_FILE = 'article.txt'; // File to store processed text content

// === TEXT PROCESSING FUNCTIONS ===

/**
 * Recursively extracts text content from XML nodes
 * @param {string|Array|Object} node - The XML node to process
 * @returns {string} - Extracted text content
 */
function extractTextContent(node) {
  // Base case: if node is string, return as-is
  if (typeof node === 'string') return node;

  // If node is array, process each element
  if (Array.isArray(node)) {
    return node.map(extractTextContent).join(' ');
  }

  // If node is object, process all values
  if (typeof node === 'object') {
    return Object.values(node).map(extractTextContent).join(' ');
  }

  // Fallback for other types
  return '';
}

/**
 * Extracts paragraphs from article sections
 * @param {Object|Array} section - The article section to process
 * @returns {string} - Concatenated paragraphs
 */
function getParagraphs(section) {
  if (!section) return ''; // Handle empty sections

  let text = '';

  // Process array of sections
  if (Array.isArray(section)) {
    for (const s of section) {
      text += getParagraphs(s) + '\n';
    }
  }
  // Process individual section
  else {
    // Extract paragraph content if exists
    if (section.p) {
      const paragraphs = Array.isArray(section.p) ? section.p : [section.p];
      for (const p of paragraphs) {
        text += extractTextContent(p).trim() + '\n';
      }
    }

    // Recursively process subsections
    if (section.sec) {
      text += getParagraphs(section.sec);
    }
  }

  return text.trim();
}

// === PUBMED/PMC UTILITY FUNCTIONS ===

/**
 * Converts PubMed ID to PMC ID
 * @param {string} pmid - PubMed article ID
 * @returns {Promise<string>} - PMC ID (without 'PMC' prefix)
 * @throws {Error} If no PMC ID found
 */
async function extractPMCID(pmid) {
  const url = `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${pmid}&format=json`;

  let retries = 5;
  while (retries > 0) {
    try {
      const { data } = await axios.get(url, { timeout: 10000 });
      const record = data.records && data.records[0];
      if (!record || !record.pmcid) throw new Error(`No PMC ID found for PMID ${pmid}.`);
      return record.pmcid.replace('PMC', ''); // Return ID without prefix
    } catch (err) {
      const isNetworkError = !err.response || err.code === 'ECONNRESET' || err.message.includes('socket hang up') || err.message.includes('timeout');
      const rateLimitText = err.response && err.response.data && JSON.stringify(err.response.data).includes('limit');
      const isTransientError = err.response && (err.response.status === 429 || err.response.status >= 500 || rateLimitText);

      if (isNetworkError || isTransientError) {
        retries--;
        if (retries === 0) throw err;
        const jitter = Math.floor(Math.random() * 2000);
        await new Promise(r => setTimeout(r, 2000 + jitter));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Fetches full article XML from PMC
 * @param {string} pmcid - PMC article ID
 * @returns {Promise<string>} - Raw XML content
 */
async function fetchFullTextXML(pmcid) {
  const url = `https://www.ncbi.nlm.nih.gov/pmc/oai/oai.cgi?verb=GetRecord&identifier=oai:pubmedcentral.nih.gov:${pmcid}&metadataPrefix=pmc`;

  let retries = 5;
  while (retries > 0) {
    try {
      const { data } = await axios.get(url, { timeout: 10000 });
      // Save raw XML for debugging
      fs.writeFileSync(OUTPUT_XML_FILE, data, 'utf-8');
      return data;
    } catch (err) {
      const isNetworkError = !err.response || err.code === 'ECONNRESET' || err.message.includes('socket hang up') || err.message.includes('timeout');
      const rateLimitText = err.response && err.response.data && JSON.stringify(err.response.data).includes('limit');
      const isTransientError = err.response && (err.response.status === 429 || err.response.status >= 500 || rateLimitText);

      if (isNetworkError || isTransientError) {
        retries--;
        if (retries === 0) throw err;
        const jitter = Math.floor(Math.random() * 2000);
        await new Promise(r => setTimeout(r, 2000 + jitter));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Extracts text from article XML
 * @param {string} xml - Raw XML content
 * @param {string} savePath - Path to save processed text
 * @returns {Promise<Object>} - Object containing title, abstract and body
 * @throws {Error} If article content cannot be extracted
 */
async function extractTextFromXML(xml, savePath = 'article.txt') {
  const parser = new xml2js.Parser({ explicitArray: false });
  const result = await parser.parseStringPromise(xml);

  // Navigate through XML structure to find article
  const article = result['OAI-PMH']?.GetRecord?.record?.metadata?.article;
  if (!article) throw new Error('Unable to extract article content.');

  // Extract title with fallback
  const title = extractTextContent(article.front?.['article-meta']?.['title-group']?.['article-title'] || '');

  // Extract abstract with fallback
  const abstract = extractTextContent(article.front?.['article-meta']?.abstract?.['p'] || '');

  // Process body content
  const body = getParagraphs(article.body || {});

  return { title, abstract, body };
}

/**
 * Constructs AI prompt from article content
 * @param {Object} content - Article content with title, abstract and body
 * @param {string} savePath - Path to save the prompt
 * @returns {string} - Formatted prompt for AI processing
 */
async function extractTextFromXML(xml, savePath = 'article.txt') {
  const parser = new xml2js.Parser({ explicitArray: false });
  const result = await parser.parseStringPromise(xml);

  const article = result['OAI-PMH']?.GetRecord?.record?.metadata?.article;
  if (!article) throw new Error('Unable to extract article content.');

  const title = extractTextContent(article.front?.['article-meta']?.['title-group']?.['article-title'] || '');
  const abstract = extractTextContent(article.front?.['article-meta']?.abstract?.['p'] || '');
  const body = getParagraphs(article.body || {});

  return { title, abstract, body };
}

function buildPromptFromContent({ title = '', abstract = '', body = '' }, savePath = 'article.txt', needsRateExtraction = false) {
  // Truncate the body to approx 15,000 characters (roughly 4,000 tokens) to avoid 'Token Limit Exceeded'
  // and prevent exhausting the Groq TPM (Tokens Per Minute) limit when running 100 concurrently.
  const MAX_BODY_LENGTH = 15000;
  const truncatedBody = body.length > MAX_BODY_LENGTH ? body.substring(0, MAX_BODY_LENGTH) + "\n...[TRUNCATED]" : body;
  const cleanText = `Title: ${title}\n\nAbstract: ${abstract}\n\nBody:\n${truncatedBody}`.trim();

  const fullPrompt = `
Objective

Act as an expert in medicine, biology, and clinical research...
[KEEP THE REST OF THE PROMPT EXACTLY AS YOU WROTE IT]

Input
${cleanText}

Task


1. Parse the study’s intervention section, if necessary (no data found), Parse study’s other sections for possible related findings.

2. Identify any natural products, substances, medications, or items discussed in the study.

3. **CRITICAL ITEM SEPARATION RULE**: You MUST create a **SEPARATE JSON object for EACH individual item** you extract.
   - NEVER group or list multiple items together in a single string (e.g., "Strawberry, Raspberry").
   - Each distinct item must have its own dedicated JSON object (record).

4. For each item's object:
   - Extract the core base COMMON name of the item into "root_name" (e.g., if the text says "blueberry juice" or "blueberry extract", the root_name MUST be just "blueberry"). If the article only mentions the scientific name (e.g., "Vaccinium corymbosum"), you MUST use your own clinical/botanical knowledge to determine and output the corresponding common name in "root_name" (e.g., output "blueberry" if the text only mentions "Vaccinium corymbosum").
   - Extract the scientific name of the item into "scientific_name" (e.g., "Vaccinium corymbosum"). If the scientific name is not explicitly mentioned in the article, determine it from your own knowledge based on the common name (e.g., if the text says "blueberry", output "Vaccinium corymbosum"). If you absolutely cannot determine it, set it to null.
   - Determine how the item was processed or administered (e.g., raw seed, aqueous extract, powder, heated, juice) and write it in "processing_status".
   - Extract any diseases or medical conditions that this item is being studied for or tested against in the article.
   - For EACH disease, create an object inside the "disease_targets" array.
   - Inside each disease object, extract its specific "disease_name", its specific "root_causes", and its specific "labs".
   - **CRITICAL DISEASE NAMING**: Standardize the "disease_name" to its globally recognized, official MeSH standard name (e.g., output "Type 2 Diabetes" instead of "Type II Diabetes Mellitus", "T2DM", or "Diabetes Mellitus, Type 2"). Never include acronyms or abbreviations in the disease name.
   - **CRITICAL**: Ensure that the root causes, labs, and all benefits are STRICTLY and EXCLUSIVELY related to the specific disease represented by the current disease target object.
   - Map beneficial effects to the most related root cause and lab measure for that disease, if available.
   - **CRITICAL BENEFIT RULE**: You MUST extract ALL root causes and ALL labs discussed in relation to the item and disease, regardless of whether they have an associated benefit. If a root cause or lab does NOT have a benefit mentioned in the text, you MUST still extract it and set its "benefit_exactly", "benefit_descriptive", "benefit", and "short_description" fields to null.
   - For the **"benefit"** or **"benefit_exactly"** fields, you **MUST** provide the **exact, original text** of the beneficial effects as found in the article. Do not modify or summarize this text. If no benefit is found, set this to null.
   - For the **"short_description"** (labs) or **"benefit_descriptive"** (root causes) fields, provide a concise, readable summary or descriptive rephrasing of the benefit in your own words. If no benefit is found, set this to null.
   - For each lab measure, provide a "quantity" which is any numerical data, measurements, or rates of increase/decrease mentioned for that lab. If no quantity is found, leave as empty string.
   - **CRITICAL LABS RULE**: Do NOT extract or include any lab measures that show "no significant" changes, effects, or differences. Omit them completely from the array. If no labs have significant positive or negative changes, set the "labs" field entirely to 'null'.
   - For lab measures, keep the original text for all **"name"** fields exactly as found.
   - For root causes, the **"name"** field MUST be ONLY the core medical, biological, or physiological mechanism (e.g., 'vitamin d deficiency', 'hyperhomocysteinemia', 'oxidative stress'). Do NOT include the disease name, context, or phrases like 'in type 2 diabetes mellitus' or 'exacerbating depressive symptoms'.
   - Extract **ALL available disease root causes** per disease dynamically. Do not limit to 10.

${needsRateExtraction ? `6. Analyze the study's (title, abstract and body) to determine its type by your self then choose the most related study type from the below rated-articles list.
- Map your single best matching output into "pubtypes".
- Map the attached rate of your chosen type into "disease_rates" as a number in the JSON array below.
- If you were unable to determine the study type return "unable to determine". 
- The rated-articles list:
   - Systematic Review: 5
   - Meta-Analysis: 5
   - Randomized Controlled Trial: 4
   - Controlled Clinical Trial: 4
   - Clinical Trial: 4
   - Clinical Trial Protocol: 3
   - Multicenter Study: 3
   - Observational Study: 3
   - Comparative Study: 3
   - Evaluation Study: 3
   - Validation Studies: 3
   - Case Reports: 2
   - Review: 2
   - Technical Report: 2
   - Editorial: 1
   - Letter: 1
   - Comment: 1
   - Consensus Development Conference: 1
   - Practice Guideline: 1
   - Guideline: 1
   - Retracted Publication: 1
   - Corrected and Republished Article: 1
   - Unable to determine: 0` : ''}

Return a **single valid JSON array** with the following schema, and **nothing else**—no markdown, no text, no explanation.

[
  {
    "root_name": "<the extracted core base common name>",
    "scientific_name": "<the scientific name of the item, or null if unknown>",
    "processing_status": "<form or preparation method>",
    ${needsRateExtraction ?
      `"pubtypes": "<the single extracted publication type>",
    "disease_rates": <calculated rate as number>,` : ''}
    "disease_targets": [
      {
        "disease_name": "<disease 1>",
        "root_causes": [
          {
            "name": "<mechanism name>",
            "benefit_exactly": "<EXACT original benefit text from article, or null if no benefit>",
            "benefit_descriptive": "<concise descriptive summary of the root cause benefit in your own words, or null if no benefit>"
          }
        ],
        "labs": [
          {
            "type": "alt_gpt",
            "name": "<lab test name>",
            "benefit": "<EXACT original medical benefit from article, or null if no benefit>",
            "short_description": "<concise descriptive summary of the lab benefit in your own words, or null if no benefit>",
            "quantity": "<quantity or increase rate if available>"
          }
        ]
      }
    ]
  }
]

**List of Lab Types to use in "type" field if applicable:**
alt_gpt, ast_got, calcium_phosphonazo, creatinine, c_reactive_protein, iron, glucose, triglycerides, uric_acid, urea, hdl_c_direct, albumin, total_cholesterol, total_bilirubin, wbc, lym, lym_percent, mid, mid_percent, gra, gra_percent, hgb, mch, mchc, rbc, mcv, hct, rdw_a, rdw, plt, mpv, pdw, pct, lpcr, hba1c, fructosamine, glycated_albumin, fasting_plasma_glucose, oral_glucose_tolerance_test, insulin, c_peptide, anti_gad_antibodies, anti_ia2_antibodies, anti_insulin_antibodies, znt8_antibodies, micrornas, adipokines, 1_5_anhydroglucitol, uacr, lipid_panel, ldl_cholesterol, vldl_cholesterol.

Important Rules:

- Leave unused fields as empty strings ("").
- Do **not** return partial items.
- Do **not** use ellipses (...).
- **Crucial**: Ensure all double quotes *within* text values (like descriptions or benefit text) are properly escaped with a backslash (e.g., \\").
- Use **only** double quotes for keys and string values.
- Do **not** include any trailing commas.
- Do **not** return any invalid JSON—only a complete JSON array.
- Return nothing if no matching items are found.



`.trim();
  fs.writeFileSync(savePath, fullPrompt, 'utf-8');
  // console.log(`📄 Full prompt saved to '${savePath}'`);

  return fullPrompt;
}


/**
 * Fetches abstract from PubMed
 * @param {string} pmid - PubMed article ID
 * @returns {Promise<string>} - Formatted abstract text
 */
async function fetchAbstractFromPubMed(pmid) {
  const API_KEY = "b587f1cf996207071196b22c8418b7259607"; // Hardcoded standard key from getURL.js
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml&api_key=${API_KEY}`;

  let retries = 3;
  let data;
  while (retries > 0) {
    try {
      const response = await axios.get(url, { timeout: 10000 });
      data = response.data;
      break;
    } catch (err) {
      const isNetworkError = !err.response || err.code === 'ECONNRESET' || err.message.includes('socket hang up') || err.message.includes('timeout');
      const rateLimitText = err.response && err.response.data && JSON.stringify(err.response.data).includes('limit');
      const isTransientError = err.response && (err.response.status === 429 || err.response.status >= 500 || rateLimitText);

      if (isNetworkError || isTransientError) {
        retries--;
        if (retries === 0) throw err;
        const jitter = Math.floor(Math.random() * 2000);
        await new Promise(r => setTimeout(r, 2000 + jitter));
      } else {
        throw err;
      }
    }
  }

  try {
    const parsed = await xml2js.parseStringPromise(data, { explicitArray: false });

    // Navigate through PubMed XML structure
    const article = parsed?.PubmedArticleSet?.PubmedArticle;
    const citation = article?.MedlineCitation?.Article;

    // Extract title with fallback
    const title = citation?.ArticleTitle || 'No title found';
    const abstractSection = citation?.Abstract;
    const abstractText = abstractSection?.AbstractText;

    let abstract = '';

    // Handle different abstract formats
    if (typeof abstractText === 'string') {
      abstract = abstractText;
    } else if (Array.isArray(abstractText)) {
      // Join multiple abstract sections
      abstract = abstractText.map(part =>
        typeof part === 'string' ? part : part._ || ''
      ).join(' ');
    } else if (typeof abstractText === 'object' && abstractText._) {
      abstract = abstractText._;
    }

    // Fallback if no abstract found
    if (!abstract) {
      fs.writeFileSync(`fallback_${pmid}.xml`, data, 'utf-8');
      return '';
    }

    return `Title: ${title}\n\nAbstract: ${abstract}\n\nBody:\n`;
  } catch (error) {
    console.error(`❌ Error fetching abstract for PMID ${pmid}:`, error.message);
    return '';
  }
}

/**
 * Main function to summarize article text
 * @param {string} pubmedUrl - PubMed article ID
 * @returns {Promise<string>} - AI-generated summary
 */
async function summarizeText(pubmedUrl, needsRateExtraction = false) {
  let pmid = null;
  try {
    const PUBMED_URL = pubmedUrl;

    // Extract PMID from URL
    const pmidMatch = PUBMED_URL.match(/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);
    if (!pmidMatch) throw new Error('Invalid PubMed URL format.');
    pmid = pmidMatch[1];

    let content;
    try {
      // Try to get full text first
      const pmcid = await extractPMCID(pmid);
      const fullTextXML = await fetchFullTextXML(pmcid);
      content = await extractTextFromXML(fullTextXML);
    } catch (err) {
      // Fall back to abstract if full text not available
      const abstractText = await fetchAbstractFromPubMed(pmid);
      if (!abstractText) throw new Error('No abstract found.');
      content = { title: '', abstract: abstractText, body: '' };
    }

    // Build and process AI prompt
    const fullPrompt = buildPromptFromContent(content, undefined, needsRateExtraction);
    const summary = await extractWithAI(fullPrompt);

    return { summary, pmid };
  } catch (error) {
    if (error.message === 'No abstract found.') {
      return { summary: "NO_CONTENT", pmid };
    }
    console.error('❌ Error:', error.response?.data || error.message);
    return { summary: null, pmid };
  }
}

/**
 * Bulk extract PMCIDs for multiple PMIDs
 */
async function bulkExtractPMCID(pmids) {
  if (!pmids || pmids.length === 0) return {};
  const url = `https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/?ids=${pmids.join(',')}&format=json&versions=no`;

  let retries = 3;
  while (retries > 0) {
    try {
      const { data } = await axios.get(url, { timeout: 10000 });
      const map = {};
      if (data && data.records) {
        for (const record of data.records) {
          if (record.pmcid) {
            map[record.pmid] = record.pmcid.replace('PMC', '');
          }
        }
      }
      return map;
    } catch (err) {
      const isNetworkError = !err.response || err.code === 'ECONNRESET' || err.message.includes('socket hang up') || err.message.includes('timeout');
      const rateLimitText = err.response && err.response.data && JSON.stringify(err.response.data).includes('limit');
      const isTransientError = err.response && (err.response.status === 429 || err.response.status >= 500 || rateLimitText);

      if (isNetworkError || isTransientError) {
        retries--;
        if (retries === 0) {
          console.error("❌ Error in bulkExtractPMCID:", err.message);
          return {};
        }
        const jitter = Math.floor(Math.random() * 2000);
        await new Promise(r => setTimeout(r, 2000 + jitter));
      } else {
        console.error("❌ Error in bulkExtractPMCID:", err.message);
        return {};
      }
    }
  }
  return {};
}

/**
 * Bulk fetch abstracts for multiple PMIDs
 */
async function bulkFetchAbstracts(pmids) {
  if (!pmids || pmids.length === 0) return {};
  const API_KEY = "b587f1cf996207071196b22c8418b7259607";
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=xml&api_key=${API_KEY}`;

  let retries = 3;
  let data;
  while (retries > 0) {
    try {
      const response = await axios.get(url, { timeout: 15000 });
      data = response.data;
      break;
    } catch (err) {
      const isNetworkError = !err.response || err.code === 'ECONNRESET' || err.message.includes('socket hang up') || err.message.includes('timeout');
      const rateLimitText = err.response && err.response.data && JSON.stringify(err.response.data).includes('limit');
      const isTransientError = err.response && (err.response.status === 429 || err.response.status >= 500 || rateLimitText);

      if (isNetworkError || isTransientError) {
        retries--;
        if (retries === 0) return {}; // Fail silently, return empty map
        const jitter = Math.floor(Math.random() * 2000);
        await new Promise(r => setTimeout(r, 2000 + jitter));
      } else {
        console.error("❌ Error fetching bulk abstracts:", err.message);
        return {};
      }
    }
  }

  const map = {};
  if (!data) return map;

  try {
    const parsed = await xml2js.parseStringPromise(data, { explicitArray: false });
    let articles = parsed?.PubmedArticleSet?.PubmedArticle || [];
    if (!Array.isArray(articles)) {
      articles = [articles];
    }

    for (const article of articles) {
      const citation = article?.MedlineCitation?.Article;
      const pmidObj = article?.MedlineCitation?.PMID;
      const pmid = typeof pmidObj === 'object' ? pmidObj._ : pmidObj;
      if (!pmid) continue;

      const title = citation?.ArticleTitle || 'No title found';
      const abstractText = citation?.Abstract?.AbstractText;
      let abstract = '';
      if (typeof abstractText === 'string') {
        abstract = abstractText;
      } else if (Array.isArray(abstractText)) {
        abstract = abstractText.map(part => typeof part === 'string' ? part : part._ || '').join(' ');
      } else if (typeof abstractText === 'object' && abstractText._) {
        abstract = abstractText._;
      }

      if (abstract) {
        map[pmid] = { title, abstract, body: '' };
      }
    }
  } catch (error) {
    console.error("❌ Error parsing bulk abstracts XML:", error.message);
  }
  return map;
}

/**
 * Pre-fetch all texts (PMC or Abstracts) for a batch of articles natively to avoid sequential 429 delays
 */
async function preFetchBatchArticles(articlesBatch) {
  const pmids = articlesBatch.map(a => a.PMID).filter(Boolean);
  if (pmids.length === 0) return {};

  console.log(`    📥 Pre-fetching text data for ${pmids.length} articles from NCBI in bulk...`);
  const pmcMap = await bulkExtractPMCID(pmids);

  const contentMap = {};
  const pmcidsToFetch = [];
  const pmidsForAbstracts = [];

  for (const pmid of pmids) {
    if (pmcMap[pmid]) {
      pmcidsToFetch.push({ pmid, pmcid: pmcMap[pmid] });
    } else {
      pmidsForAbstracts.push(pmid);
    }
  }

  // Fetch full text PMC XMLs in small chunks (e.g. 10 concurrent) to avoid crashing or rate-limit
  const chunkSize = 10;
  for (let i = 0; i < pmcidsToFetch.length; i += chunkSize) {
    const chunk = pmcidsToFetch.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async ({ pmid, pmcid }) => {
      try {
        const fullTextXML = await fetchFullTextXML(pmcid);
        const content = await extractTextFromXML(fullTextXML);
        contentMap[pmid] = content;
      } catch (err) {
        // If full text fails, fallback to extracting abstract
        pmidsForAbstracts.push(pmid);
      }
    }));
  }

  // Bulk fetch the remaining abstracts via 1 huge request
  if (pmidsForAbstracts.length > 0) {
    const abstractsMap = await bulkFetchAbstracts(pmidsForAbstracts);
    for (const [pmid, content] of Object.entries(abstractsMap)) {
      contentMap[pmid] = content;
    }
  }

  console.log(`    ✅ Perfectly Pre-fetched texts for ${Object.keys(contentMap).length} articles.`);
  return contentMap;
}

async function summarizePreFetchedContent(content, needsRateExtraction = false) {
  try {
    if (!content || (!content.abstract && !content.body)) {
      return { summary: "NO_CONTENT" };
    }
    const fullPrompt = buildPromptFromContent(content, undefined, needsRateExtraction);
    const summary = await extractWithAI(fullPrompt);
    return { summary };
  } catch (error) {
    console.error('❌ Error in AI summarize:', error.message);
    return { summary: null };
  }
}

module.exports = {
  summarizeText,
  preFetchBatchArticles,
  summarizePreFetchedContent
};