require('dotenv').config();
const { Disease, ResearchResult, sequelize } = require('./models/all');
const fs = require('fs');
const path = require('path');

async function check() {
  try {
    console.log('Testing DB connection...');
    await sequelize.authenticate();
    console.log('Connected!');

    // Read from disease_mappings.json
    const mappingsFile = path.join(__dirname, 'disease_mappings.json');
    if (fs.existsSync(mappingsFile)) {
      const content = JSON.parse(fs.readFileSync(mappingsFile, 'utf8'));
      console.log('disease_mappings.json keys:', Object.keys(content.mapData || {}));
    } else {
      console.log('disease_mappings.json does not exist.');
    }

    /*
    // Query unique diseases from DB
    const diseases = await Disease.findAll();
    console.log(`DB diseases count: ${diseases.length}`);
    diseases.forEach(d => {
      console.log(`- ID: ${d.id}, Name: ${d.name}, Code: ${d.code}`);
    });
    */

    const uniqueResDiseases = await ResearchResult.findAll({
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('disease')), 'disease']]
    });
    console.log('Unique diseases in research_results:');
    uniqueResDiseases.forEach(r => {
      console.log(`- ${r.disease}`);
    });

  } catch (e) {
    console.error('Error:', e);
  } finally {
    await sequelize.close();
  }
}

check();
