const { sequelize, ResearchResult } = require('./models/all');

async function check() {
    await sequelize.authenticate();
    const rows = await ResearchResult.findAll({
        where: { productId: 22 }, // pomegranate is productId 22 ? Or we can just check recent rows
        order: [['createdAt', 'DESC']],
        limit: 10
    });
    
    console.log(`Found ${rows.length} rows`);
    for (const r of rows) {
        console.log(`ID: ${r.id}, PMID: ${r.PMID}, ai_pubtypes: ${r.ai_pubtypes}, title: ${String(r.title).substring(0,30)}`);
    }
    await sequelize.close();
}
check();
