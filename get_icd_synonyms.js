require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 1. DEFAULT DISEASE LIST FROM USER REQUEST
const DEFAULT_DISEASES = [
  'type 2 diabetes',
  'non alcoholic fatty liver disease',
  'alzheimer s disease',
  'urinary tract infections',
  'hypercholesterolemia',
  'dyslipidemia',
  'coronary disease',
  'cardiovascular disease',
  'cancer',
  'prediabetes',
  'insulin resistance',
  'hypertension',
  'obesity',
  'metabolic syndrome'
];

// File output paths
const JS_OUTPUT_FILE = path.join(__dirname, 'medical_synonyms.js');
const JSON_OUTPUT_FILE = path.join(__dirname, 'icd_medical_synonyms.json');

/**
 * Normalizes and extracts terms from raw strings (including bracketed abbreviations/descriptions).
 * E.g., "niddm - [non insulin dependent diabetes mellitus]" yields:
 * - "niddm - [non insulin dependent diabetes mellitus]"
 * - "niddm"
 * - "non insulin dependent diabetes mellitus"
 */
function cleanAndExtractTerms(rawTerm) {
  if (!rawTerm) return [];
  const results = [];
  
  // Clean and lowercase
  const clean = rawTerm.toLowerCase().trim().replace(/\s+/g, ' ');
  if (clean.length > 0) {
    results.push(clean);
  }

  // Handle bracket abbreviation pattern: "abbrev - [description]" or "abbrev [description]"
  const bracketRegex = /^([a-z0-9]+)\s*-\s*\[(.+?)\]$/i;
  const match = clean.match(bracketRegex);
  if (match) {
    const abbrev = match[1].trim();
    const description = match[2].trim();
    if (abbrev.length > 0) results.push(abbrev);
    if (description.length > 0) results.push(description);
  }

  return results;
}

/**
 * Fetches the OAuth 2.0 Token from WHO Access Management
 */
async function getICDToken(clientId, clientSecret) {
  const tokenUrl = 'https://icdaccessmanagement.who.int/connect/token';
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await axios.post(tokenUrl, 'grant_type=client_credentials&scope=icdapi_access', {
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });

  return response.data.access_token;
}

/**
 * Searches the ICD-11 Foundation Component for a query string
 */
async function searchICDEntity(query, token) {
  const searchUrl = `https://id.who.int/icd/entity/search?q=${encodeURIComponent(query)}`;
  
  const response = await axios.get(searchUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'API-Version': 'v2',
      'Accept': 'application/json',
      'Accept-Language': 'en'
    }
  });
  
  return response.data.destinationEntities || [];
}

/**
 * Fetches full entity details from its direct WHO URI
 */
async function fetchEntityDetails(entityUrl, token) {
  const response = await axios.get(entityUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'API-Version': 'v2',
      'Accept': 'application/json',
      'Accept-Language': 'en'
    }
  });
  
  return response.data;
}

/**
 * Main Execution Function
 */
async function main() {
  const clientId = process.env.ICD_CLIENT_ID;
  const clientSecret = process.env.ICD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('❌ Error: ICD_CLIENT_ID or ICD_CLIENT_SECRET not found in .env');
    console.error('Please configure your WHO credentials in the workspace .env file.');
    process.exit(1);
  }

  console.log('======================================================');
  console.log('  ICD-11 CLINICAL SYNONYM EXTRACTION UTILITY');
  console.log('======================================================');

  try {
    // 1. Authenticate
    console.log('🔑 Authenticating with WHO Access Management...');
    const token = await getICDToken(clientId, clientSecret);
    console.log('✅ Access Token acquired successfully.');

    const finalSynonymsMap = {};

    // 2. Iterate through diseases
    for (let i = 0; i < DEFAULT_DISEASES.length; i++) {
      const diseaseQuery = DEFAULT_DISEASES[i];
      console.log(`\n🔍 [${i + 1}/${DEFAULT_DISEASES.length}] Searching for: "${diseaseQuery}"...`);

      // Search
      const searchResults = await searchICDEntity(diseaseQuery, token);
      if (searchResults.length === 0) {
        console.warn(`⚠️ No matches found for "${diseaseQuery}" in ICD-11.`);
        // Fallback: keep just the query itself
        finalSynonymsMap[diseaseQuery] = [diseaseQuery];
        continue;
      }

      // Get best match and fetch full details
      const bestMatch = searchResults[0];
      console.log(`   └─ Found Best Match: "${bestMatch.title.replace(/<[^>]*>/g, '')}" (ID: ${bestMatch.id.split('/').pop()})`);
      
      console.log(`   └─ Fetching complete entity details...`);
      const details = await fetchEntityDetails(bestMatch.id, token);

      // Collect terms
      const uniqueTerms = new Set();
      
      // Add the original search term
      uniqueTerms.add(diseaseQuery.toLowerCase().trim());

      // Add entity primary title
      if (details.title && details.title['@value']) {
        cleanAndExtractTerms(details.title['@value']).forEach(t => uniqueTerms.add(t));
      }

      // Add synonyms
      if (details.synonym && Array.isArray(details.synonym)) {
        details.synonym.forEach(s => {
          if (s.label && s.label['@value']) {
            cleanAndExtractTerms(s.label['@value']).forEach(t => uniqueTerms.add(t));
          }
        });
      }

      // Add inclusions
      if (details.inclusion && Array.isArray(details.inclusion)) {
        details.inclusion.forEach(inc => {
          if (inc.label && inc.label['@value']) {
            cleanAndExtractTerms(inc.label['@value']).forEach(t => uniqueTerms.add(t));
          }
        });
      }

      // Convert Set to Array
      const termsArray = Array.from(uniqueTerms);
      finalSynonymsMap[diseaseQuery] = termsArray;

      console.log(`   └─ Extracted ${termsArray.length} unique synonyms/aliases.`);
    }

    // 3. Write JS File Output
    console.log('\n💾 Formatting and saving output files...');

    const jsContent = `/**
 * Generated Medical Synonyms from WHO ICD-11 Official API
 * Generated on: ${new Date().toISOString().split('T')[0]}
 */
const MEDICAL_SYNONYMS = ${JSON.stringify(finalSynonymsMap, null, 2)};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MEDICAL_SYNONYMS;
}
`;

    fs.writeFileSync(JS_OUTPUT_FILE, jsContent, 'utf8');
    console.log(`✅ Saved JavaScript Module: ${path.basename(JS_OUTPUT_FILE)}`);

    // 4. Write JSON File Output
    fs.writeFileSync(JSON_OUTPUT_FILE, JSON.stringify(finalSynonymsMap, null, 2), 'utf8');
    console.log(`✅ Saved JSON Data: ${path.basename(JSON_OUTPUT_FILE)}`);

    console.log('\n🎉 Done! All synonyms successfully retrieved and stored.');
    console.log('======================================================\n');

  } catch (error) {
    console.error('\n❌ Fatal Error during execution:');
    if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Details:`, error.response.data);
    } else {
      console.error(`   Message: ${error.message}`);
    }
    process.exit(1);
  }
}

main();
