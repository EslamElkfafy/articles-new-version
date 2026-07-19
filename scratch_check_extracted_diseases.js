const fs = require('fs');
const path = require('path');

const dirPath = 'd:\\backup\\New folder\\bigScript(most important)\\new version\\bigScript\\all diseases';

function check() {
  const files = fs.readdirSync(dirPath);
  const jsonFiles = files.filter(f => f.endsWith('.json'));
  console.log('JSON files in all diseases:', jsonFiles);

  const diseasesFound = new Set();

  for (const file of jsonFiles) {
    const filePath = path.join(dirPath, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(data)) {
        data.forEach(item => {
          if (item.disease_name) {
            diseasesFound.add(item.disease_name);
          }
          if (item.articles) {
            item.articles.forEach(art => {
              if (art.diseases && Array.isArray(art.diseases)) {
                art.diseases.forEach(d => diseasesFound.add(d));
              }
              if (art.disease_targets && Array.isArray(art.disease_targets)) {
                art.disease_targets.forEach(dt => {
                  if (dt.disease_name) {
                    diseasesFound.add(dt.disease_name);
                  }
                });
              }
            });
          }
        });
      }
    } catch (e) {
      console.error(`Error reading ${file}:`, e.message);
    }
  }

  console.log('Unique diseases found in JSON files:');
  console.log(Array.from(diseasesFound));
}

check();
