const fs = require('fs');

let content = fs.readFileSync('getContent.js', 'utf8');

// Replace instructions
content = content.replace(
  'its specific root causes and benefits are accurately mapped',
  'its specific root causes (Or Pathophysiology) and benefits are accurately mapped'
);

content = content.replace(
  'Ensure that the root causes, labs, and all benefits (both descriptive and exactly for both root causes and labs) are STRICTLY and EXCLUSIVELY related to the specific item represented by THIS JSON object. If this JSON object is for "item_name", its root causes and benefits MUST belong ONLY to the item in "item_name". If this JSON object is for "another_item", its root causes and benefits MUST belong ONLY to the item in "another_item". Do not mix a benefit or root cause of one item to the JSON object of a different item.',
  'Ensure that the root causes (Or Pathophysiology), labs, and all benefits (both descriptive and exactly for both root causes/pathophysiologies and labs) are STRICTLY and EXCLUSIVELY related to the specific item represented by THIS JSON object. If this JSON object is for "item_name", its root causes (Or Pathophysiology) and benefits MUST belong ONLY to the item in "item_name". If this JSON object is for "another_item", its root causes (Or Pathophysiology) and benefits MUST belong ONLY to the item in "another_item". Do not mix a benefit or root cause (Or Pathophysiology) of one item to the JSON object of a different item.'
);

content = content.replace(
  'Map its beneficial effects to the most related root cause and lab measure',
  'Map its beneficial effects to the most related root cause (Or Pathophysiology) and lab measure'
);

content = content.replace(
  'or "benefit_descriptive" (root causes) fields',
  'or "benefit_descriptive" (root causes / pathophysiologies) fields'
);

content = content.replace(
  'Limit the root causes output **up to 20 disease root causes**',
  'Limit the root causes (Or Pathophysiology) output **up to 20 disease root causes (Or Pathophysiology)**'
);

content = content.replace(
  'fill the root causes sequentially starting from root_cause_1',
  'fill the root causes (Or Pathophysiology) sequentially starting from root_cause_1'
);

// Replace JSON placeholders
content = content.replace(/\\"<mechanism name>\\"/g, '"<mechanism name Or Pathophysiology>"');
content = content.replace(/"<mechanism name>"/g, '"<mechanism name Or Pathophysiology>"');

content = content.replace(/root cause benefit in your own words/g, 'root cause (Or Pathophysiology) benefit in your own words');

fs.writeFileSync('getContent.js', content, 'utf8');
console.log('Update complete.');
