require('dotenv').config();
const { sequelize } = require('./models/all');

async function run() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to database.');

    console.log('🔄 Updating "productId" to 24 for "apples" root cause records...');
    const [affectedRows] = await sequelize.query(`
      UPDATE research_results
      SET "productId" = 24
      WHERE root_name = 'apples' OR root_name = 'apple';
    `);

    console.log(`✅ Database update complete. Affected rows: ${affectedRows?.rowCount ?? 0}`);
  } catch (err) {
    console.error('❌ Database update failed:', err.message);
  } finally {
    await sequelize.close();
    console.log('🔒 DB connection closed.');
  }
}

run();
