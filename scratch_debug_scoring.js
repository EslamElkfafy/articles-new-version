const MEDICAL_SYNONYMS = {
  'insulin resistance': [
    'insulin resistance', 'impaired insulin sensitivity', 'insulin-resistant'
  ]
};

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

function calculateMatchScore(disease, icdTitle) {
  const dClean = disease.toLowerCase().trim();
  const iClean = icdTitle.toLowerCase().trim();
  
  console.log(`\nComparing "${dClean}" vs "${iClean}"`);
  
  if (dClean === iClean) return 1.0;
  
  let bestScore = 0;
  const synonyms = MEDICAL_SYNONYMS[dClean] || [dClean];
  
  for (const syn of synonyms) {
    const sClean = syn.toLowerCase().trim();
    if (sClean === iClean) return 1.0;
    
    const dice = computeDiceCoefficient(sClean, iClean);
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
    
    let currentScore = (dice * 0.35) + (jaccard * 0.45) + (overlapRatio * 0.20);
    
    console.log(`  For synonym "${sClean}":`);
    console.log(`    Dice: ${dice.toFixed(3)}`);
    console.log(`    Jaccard: ${jaccard.toFixed(3)}`);
    console.log(`    Overlap: ${overlapRatio.toFixed(3)}`);
    console.log(`    isSub: ${isSub}`);
    console.log(`    Base score: ${currentScore.toFixed(3)}`);
    
    if (isSub) {
      currentScore = Math.max(currentScore, 0.75) + 0.15;
      console.log(`    Score after isSub boost: ${currentScore.toFixed(3)}`);
    }
    
    currentScore = Math.min(currentScore, 0.99);
    if (currentScore > bestScore) {
      bestScore = currentScore;
    }
  }
  return bestScore;
}

console.log('Result for "Ant":', calculateMatchScore('insulin resistance', 'Ant'));
console.log('Result for "Insulin-resistance syndromes":', calculateMatchScore('insulin resistance', 'Insulin-resistance syndromes'));
