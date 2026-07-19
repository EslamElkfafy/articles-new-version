const fs = require('fs');
const path = require('path');

const FULL_ROOTS_FILE = path.join(__dirname, 'Full-Roots.json');
const AI_TO_FULL_MAPPINGS_FILE = path.join(__dirname, 'ai_to_full_roots_mappings.json');

const fullRootsIndex = new Map();
if (fs.existsSync(FULL_ROOTS_FILE)) {
  const data = JSON.parse(fs.readFileSync(FULL_ROOTS_FILE, 'utf8'));
  for (const item of data) {
    if (item.id) {
      const targetId = parseInt(item.id, 10) || 0;
      if (item.Root) fullRootsIndex.set(item.Root.toLowerCase().trim(), targetId);
      if (item.name_en) fullRootsIndex.set(item.name_en.toLowerCase().trim(), targetId);
      if (item['Best MeSH match']) fullRootsIndex.set(item['Best MeSH match'].toLowerCase().trim(), targetId);
    }
  }
}

let aiToFullMappings = {};
if (fs.existsSync(AI_TO_FULL_MAPPINGS_FILE)) {
  aiToFullMappings = JSON.parse(fs.readFileSync(AI_TO_FULL_MAPPINGS_FILE, 'utf8'));
}

function getMappedId(cleanItemName) {
  function findTargetId(name) {
    const mapping = aiToFullMappings[name];
    if (mapping && mapping.mapped && mapping.fullRootsRecord && mapping.fullRootsRecord.id) {
      return parseInt(mapping.fullRootsRecord.id, 10) || 0;
    }
    if (fullRootsIndex.has(name)) {
      return fullRootsIndex.get(name);
    }
    return 0;
  }

  let targetId = findTargetId(cleanItemName);

  if (targetId === 0) {
    let singular = cleanItemName;
    if (cleanItemName.endsWith('ies')) {
      singular = cleanItemName.slice(0, -3) + 'y';
    } else if (cleanItemName.endsWith('es')) {
      const test1 = cleanItemName.slice(0, -2);
      const test2 = cleanItemName.slice(0, -1);
      if (findTargetId(test1) > 0) singular = test1;
      else if (findTargetId(test2) > 0) singular = test2;
    } else if (cleanItemName.endsWith('s') && !cleanItemName.endsWith('ss')) {
      singular = cleanItemName.slice(0, -1);
    }

    if (singular !== cleanItemName) {
      targetId = findTargetId(singular);
    }
  }
  return targetId;
}

console.log('Testing "apple" -> expected 24, got:', getMappedId('apple'));
console.log('Testing "apples" -> expected 24, got:', getMappedId('apples'));
console.log('Testing "blueberries" -> expected 3, got:', getMappedId('blueberries'));
console.log('Testing "pears" -> expected 26, got:', getMappedId('pears'));
