require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Try loading database models, fallback gracefully if DB is offline or not configured
let sequelize = null;
let DiseaseModel = null;
let ResearchResultModel = null;

try {
  const models = require('./models/all');
  sequelize = models.sequelize;
  DiseaseModel = models.Disease;
  ResearchResultModel = models.ResearchResult;
  console.log('✅ Successfully loaded database models.');
} catch (e) {
  console.warn('⚠️ Could not load database models. Database synchronization will be skipped.', e.message);
}

// ----------------------------------------------------
// 1. CONFIGURATION & MEDICAL SYNONYM LEXICON
// ----------------------------------------------------
const EXCEL_FILE = path.join(__dirname, 'SimpleTabulation-ICD-11-MMS-en.xlsx');
const MAPPING_OUTPUT_FILE = path.join(__dirname, 'icd11_disease_mappings.json');

// Clinical synonym map to handle complex clinical spelling and terminology variations
const MEDICAL_SYNONYMS = {
  'type 2 diabetes': [
    'type 2 diabetes', 'diabetes mellitus type 2', 'type ii diabetes', 't2dm', 
    'non-insulin-dependent diabetes', 'type 2 diabetes mellitus'
  ],
  'non alcoholic fatty liver disease': [
    'nonalcoholic fatty liver disease', 'non-alcoholic fatty liver disease', 'nafld', 
    'steatohepatitis', 'nash', 'nonalcoholic steatohepatitis', 'fatty liver'
  ],
  'alzheimer s disease': [
    'alzheimer', 'alzheimer disease', 'alzheimers disease', 'alzheimer s disease', 
    'dementia due to alzheimer'
  ],
  'urinary tract infections': [
    'urinary tract infection', 'urinary tract infections', 'uti', 'cystitis', 
    'infections of urinary tract'
  ],
  'hypercholesterolemia': [
    'hypercholesterolaemia', 'hypercholesterolemia', 'cholesterolemia', 
    'pure hypercholesterolemia', 'familial hypercholesterolemia'
  ],
  'dyslipidemia': [
    'dyslipidaemia', 'dyslipidemia', 'lipoprotein metabolism', 'lipidaemia', 
    'hyperlipidemia', 'hyperlipidaemia'
  ],
  'coronary disease': [
    'coronary artery disease', 'coronary disease', 'coronary heart disease', 
    'ischaemic heart disease', 'ischemic heart disease', 'angina', 'myocardial infarction'
  ],
  'cardiovascular disease': [
    'cardiovascular disease', 'cardiovascular diseases', 'circulatory system', 
    'heart disease', 'diseases of the circulatory system'
  ],
  'cancer': [
    'neoplasms', 'neoplasm', 'malignant neoplasm', 'cancer', 'tumor', 'tumour', 
    'malignancy', 'malignancies'
  ],
  'prediabetes': [
    'prediabetes', 'pre-diabetes', 'impaired glucose tolerance', 'borderline diabetes'
  ],
  'insulin resistance': [
    'insulin resistance', 'impaired insulin sensitivity', 'insulin-resistant'
  ],
  'hypertension': [
    'hypertension', 'essential hypertension', 'high blood pressure', 'hypertensive disease'
  ],
  'obesity': [
    'obesity', 'overweight', 'adiposity'
  ],
  'metabolic syndrome': [
    'metabolic syndrome', 'syndrome x', 'insulin resistance syndrome'
  ]
};

// ----------------------------------------------------
// 2. TEXT PROCESSING & SCORING FUNCTIONS
// ----------------------------------------------------

/**
 * Clean noise words and get core lowercase tokens
 */
function getCleanWords(str) {
  if (!str) return [];
  const stopWords = new Set([
    'of', 'and', 'or', 'to', 'in', 'with', 'due', 'by', 'the', 'a', 'an', 
    'for', 'other', 'unspecified', 'without', 'associated', 'onset', 'class'
  ]);
  return str.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !stopWords.has(w));
}

/**
 * Clean formatting from ICD titles (remove leading dashes, brackets, etc.)
 */
function cleanIcdTitle(title) {
  if (!title) return '';
  return title.replace(/^[\s\-]+/, '').trim();
}

/**
 * Generate character bigrams for Dice Coefficient
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
 * Main local hybrid matching score calculation between target disease and ICD title
 */
function calculateMatchScore(disease, icdTitle) {
  const dClean = disease.toLowerCase().trim();
  const iClean = icdTitle.toLowerCase().trim();
  
  // Exact Match
  if (dClean === iClean) return 1.0;
  
  let bestScore = 0;
  
  // Resolve synonyms
  const synonyms = MEDICAL_SYNONYMS[dClean] || [dClean];
  
  for (const syn of synonyms) {
    const sClean = syn.toLowerCase().trim();
    
    // Exact synonym match
    if (sClean === iClean) {
      bestScore = Math.max(bestScore, 1.0);
      continue;
    }
    
    // Dice character coefficient
    const dice = computeDiceCoefficient(sClean, iClean);
    
    // Word/token Jaccard overlap
    const sWords = getCleanWords(sClean);
    const iWords = getCleanWords(iClean);
    
    let matchCount = 0;
    for (const w of sWords) {
      if (iWords.includes(w)) matchCount++;
    }
    
    const jaccard = sWords.length > 0 ? matchCount / (sWords.length + iWords.length - matchCount) : 0;
    const overlapRatio = sWords.length > 0 ? matchCount / sWords.length : 0;
    
    // Substring boost only on word boundary and with length >= 4
    const shorter = sClean.length < iClean.length ? sClean : iClean;
    const longer = sClean.length < iClean.length ? iClean : sClean;
    const longerClean = ' ' + longer.replace(/[^a-z0-9]/g, ' ') + ' ';
    const shorterClean = shorter.trim().replace(/[^a-z0-9]/g, ' ');
    const isSub = shorter.length >= 4 && longerClean.includes(' ' + shorterClean + ' ');
    
    // Compute weighted scoring
    let currentScore = (dice * 0.35) + (jaccard * 0.45) + (overlapRatio * 0.20);
    
    if (isSub) {
      currentScore = Math.max(currentScore, 0.75) + 0.15;
    }
    
    // Cap at 0.99 for non-exact matches to maintain hierarchy
    currentScore = Math.min(currentScore, 0.99);
    
    if (currentScore > bestScore) {
      bestScore = currentScore;
    }
  }
  
  return bestScore;
}

// ----------------------------------------------------
// 3. MAIN RUNNER FUNCTION
// ----------------------------------------------------
async function main() {
  console.log('🚀 Starting local High-Performance Disease Matcher...');
  const startTime = Date.now();

  // --- Step A: Gather Unique Diseases ---
  console.log('\n🔍 Step 1: Gathering target diseases from files and database...');
  const diseasesToMap = new Map(); // name -> metadata { id, source }

  // 1. Load from disease_mappings.json
  const mappingsFile = path.join(__dirname, 'disease_mappings.json');
  if (fs.existsSync(mappingsFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(mappingsFile, 'utf8'));
      if (data && data.mapData) {
        for (const [name, id] of Object.entries(data.mapData)) {
          diseasesToMap.set(name.toLowerCase().trim(), { id, originalName: name, source: 'disease_mappings.json' });
        }
      }
    } catch (e) {
      console.error('⚠️ Error reading disease_mappings.json:', e.message);
    }
  }



  // 3. Load from DB research_results
  if (sequelize) {
    try {
      await sequelize.authenticate();
      const dbDiseases = await ResearchResultModel.findAll({
        attributes: [[sequelize.fn('DISTINCT', sequelize.col('disease')), 'disease']]
      });
      dbDiseases.forEach(row => {
        if (row.disease) {
          const clean = row.disease.toLowerCase().trim();
          if (!diseasesToMap.has(clean)) {
            diseasesToMap.set(clean, { id: null, originalName: row.disease, source: 'DB research_results' });
          }
        }
      });
    } catch (dbErr) {
      console.warn('⚠️ Could not fetch from DB research_results table:', dbErr.message);
    }
  }

  // Fallback defaults if no diseases found (sanity check)
  if (diseasesToMap.size === 0) {
    console.log('ℹ️ No disease sources found. Using standard project fallbacks.');
    const fallbacks = [
      'type 2 diabetes', 'non alcoholic fatty liver disease', 'prediabetes', 
      'insulin resistance', 'dyslipidemia', 'hypertension', 'obesity', 
      'cardiovascular disease', 'alzheimer s disease', 'urinary tract infections', 
      'hypercholesterolemia', 'metabolic syndrome', 'cancer', 'coronary disease'
    ];
    fallbacks.forEach((name, i) => {
      diseasesToMap.set(name, { id: i + 1, originalName: name, source: 'fallbacks' });
    });
  }

  console.log(`✅ Collected ${diseasesToMap.size} unique diseases to match.`);
  console.log(Array.from(diseasesToMap.keys()).map(k => ` - "${k}"`).join('\n'));

  // --- Step B: Parse Excel Sheet ---
  console.log(`\n📊 Step 2: Parsing Excel file: ${path.basename(EXCEL_FILE)}...`);
  if (!fs.existsSync(EXCEL_FILE)) {
    console.error(`❌ Error: SimpleTabulation-ICD-11-MMS-en.xlsx not found at ${EXCEL_FILE}`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(EXCEL_FILE);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const icdRows = XLSX.utils.sheet_to_json(worksheet);
  console.log(`✅ Loaded ${icdRows.length} rows from sheet.`);

  // Clean and filter ICD-11 rows in memory
  console.log('🧹 Indexing and cleaning ICD-11 classification records...');
  const icdCleanRecords = [];
  for (const row of icdRows) {
    const rawTitle = row['Title'];
    const classKind = String(row['ClassKind'] || '').toLowerCase();
    
    // We match against 'category' or 'block' records which contain medical diseases/disorders
    if (rawTitle && (classKind === 'category' || classKind === 'block')) {
      icdCleanRecords.push({
        foundationUri: row['Foundation URI'] || '',
        linearizationUri: row['Linearization URI'] || '',
        code: row['Code'] || '',
        blockId: row['BlockId'] || '',
        originalTitle: rawTitle,
        cleanTitle: cleanIcdTitle(rawTitle),
        classKind: classKind,
        chapterNo: row['ChapterNo'] || ''
      });
    }
  }
  console.log(`✅ Filtered down to ${icdCleanRecords.length} clinical categories and blocks.`);

  // --- Step C: Run Local Matching Heuristic ---
  console.log('\n🧬 Step 3: Computing hybrid matches across all 36,000+ items...');
  const matchResults = {};
  const reportRows = [];

  for (const [cleanName, meta] of diseasesToMap.entries()) {
    let bestMatch = null;
    let highestScore = 0;
    const candidates = [];

    // Calculate score for all records
    for (const record of icdCleanRecords) {
      const score = calculateMatchScore(cleanName, record.cleanTitle);
      
      if (score > 0.3) { // Minimum threshold to keep as candidate
        candidates.push({ record, score });
      }
      
      if (score > highestScore) {
        highestScore = score;
        bestMatch = record;
      }
    }

    // Sort candidates to show alternatives if needed
    candidates.sort((a, b) => b.score - a.score);

    // Matching criteria threshold (e.g. score must be > 0.55 to be an official match)
    const MATCH_THRESHOLD = 0.55;
    const isMatched = highestScore >= MATCH_THRESHOLD && bestMatch;

    if (isMatched) {
      matchResults[cleanName] = {
        diseaseName: meta.originalName,
        mapped: true,
        score: parseFloat(highestScore.toFixed(3)),
        code: bestMatch.code || bestMatch.blockId,
        title: bestMatch.cleanTitle,
        originalTitle: bestMatch.originalTitle,
        classKind: bestMatch.classKind,
        linearizationUri: bestMatch.linearizationUri,
        foundationUri: bestMatch.foundationUri,
        chapterNo: bestMatch.chapterNo,
        alternatives: candidates.slice(1, 5).map(c => ({
          code: c.record.code || c.record.blockId,
          title: c.record.cleanTitle,
          score: parseFloat(c.score.toFixed(3))
        }))
      };

      reportRows.push({
        status: '✅ MATCHED',
        original: meta.originalName,
        score: `${(highestScore * 100).toFixed(1)}%`,
        icdCode: bestMatch.code || bestMatch.blockId,
        icdTitle: bestMatch.cleanTitle
      });
    } else {
      matchResults[cleanName] = {
        diseaseName: meta.originalName,
        mapped: false,
        score: parseFloat(highestScore.toFixed(3)),
        code: null,
        title: null,
        alternatives: candidates.slice(0, 5).map(c => ({
          code: c.record.code || c.record.blockId,
          title: c.record.cleanTitle,
          score: parseFloat(c.score.toFixed(3))
        }))
      };

      reportRows.push({
        status: '❌ NO MATCH',
        original: meta.originalName,
        score: `${(highestScore * 100).toFixed(1)}%`,
        icdCode: 'N/A',
        icdTitle: candidates.length > 0 ? `Best fail: "${candidates[0].record.cleanTitle}"` : 'None'
      });
    }
  }

  // --- Step D: Save JSON Mapping File ---
  console.log(`\n💾 Step 4: Saving persistent mapping file to ${MAPPING_OUTPUT_FILE}...`);
  fs.writeFileSync(MAPPING_OUTPUT_FILE, JSON.stringify(matchResults, null, 2), 'utf8');
  console.log('✅ Mapping saved successfully.');

  // --- Step E: Sync to PostgreSQL Database ---
  let syncedDbCount = 0;
  if (sequelize && DiseaseModel) {
    console.log('\n🗄️ Step 5: Synchronizing mapped diseases with PostgreSQL database...');
    try {
      // Connect
      await sequelize.authenticate();

      // Ensure columns exist in research_results (self-healing migration)
      await sequelize.query(`
        ALTER TABLE research_results
        ADD COLUMN IF NOT EXISTS code TEXT,
        ADD COLUMN IF NOT EXISTS foundation_url TEXT,
        ADD COLUMN IF NOT EXISTS icd_title TEXT;
      `);
      console.log('   ✅ Table `research_results` has been verified/migrated.');
      
      const { Op } = require('sequelize');

      for (const [cleanName, match] of Object.entries(matchResults)) {
        if (!match.mapped) continue;
        
        const meta = diseasesToMap.get(cleanName);
        const codeValue = match.code;
        const nameValue = match.title; // Canonical ICD name, or diseaseName
        
        // Match standard ID from mappings, or fall back to auto-increment
        let targetId = meta.id;
        
        let existingDisease = null;
        if (targetId) {
          existingDisease = await DiseaseModel.findByPk(targetId);
        } else {
          existingDisease = await DiseaseModel.findOne({ where: { name: match.diseaseName } });
        }
        
        const foundationUrl = match.foundationUri || null;
        const icdTitle = match.title || null;

        if (existingDisease) {
          existingDisease.code = codeValue;
          existingDisease.name = match.diseaseName;
          existingDisease.foundation_url = foundationUrl;
          existingDisease.icd_title = icdTitle;
          await existingDisease.save();
          console.log(`   🔄 Updated DB Disease [ID: ${existingDisease.id}]: "${existingDisease.name}" -> Code: ${codeValue} | ICD Title: ${icdTitle} | URL: ${foundationUrl}`);
        } else {
          const createPayload = { name: match.diseaseName, code: codeValue, foundation_url: foundationUrl, icd_title: icdTitle };
          if (targetId) {
            createPayload.id = targetId;
          }
          const newRow = await DiseaseModel.create(createPayload);
          console.log(`   ➕ Created DB Disease [ID: ${newRow.id}]: "${newRow.name}" -> Code: ${codeValue} | ICD Title: ${icdTitle} | URL: ${foundationUrl}`);
        }

        // Update corresponding research_results using raw SQL
        const [rowsAffected] = await sequelize.query(
          `UPDATE research_results
           SET code = :code,
               foundation_url = :url,
               icd_title = :icdTitle
           WHERE "diseaseId" = :diseaseId OR LOWER(disease) = LOWER(:diseaseName) OR LOWER(disease) = LOWER(:cleanName)`,
          {
            replacements: {
              code: codeValue,
              url: foundationUrl,
              icdTitle: icdTitle,
              diseaseId: targetId || 0,
              diseaseName: match.diseaseName,
              cleanName: cleanName
            },
            type: sequelize.QueryTypes.UPDATE
          }
        );
        if (rowsAffected > 0) {
          console.log(`      ↳ 🔄 Synced ICD columns in ${rowsAffected} research_results rows.`);
        }

        syncedDbCount++;
      }
      console.log(`✅ Successfully synced ${syncedDbCount} diseases in database.`);
    } catch (dbSyncErr) {
      console.error('⚠️ Database sync failed:', dbSyncErr.message);
    } finally {
      await sequelize.close();
      console.log('🔒 Closed database connection.');
    }
  }

  // --- Step F: Output Gorgeous Console Report ---
  console.log('\n========================================================================================');
  console.log('                        DISEASE TO ICD-11 MATCHER REPORT                                ');
  console.log('========================================================================================');
  console.table(reportRows);
  console.log('========================================================================================');
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`✨ Done! Local matching complete in ${elapsed} seconds.`);
}

main().catch(err => {
  console.error('❌ Script failed with fatal error:', err);
});
