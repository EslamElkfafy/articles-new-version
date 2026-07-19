require("dotenv").config();
const { sequelize, ResearchResult } = require("./models/all");

async function check() {
    try {
        await sequelize.authenticate();
        console.log("Connected to DB");

        const total = await ResearchResult.count();
        console.log("Total records:", total);

        const countZeroProduct = await ResearchResult.count({ where: { productId: 0 } });
        console.log("Records with productId = 0:", countZeroProduct);

        const countNullProduct = await ResearchResult.count({ where: { productId: null } });
        console.log("Records with productId = null:", countNullProduct);

        const samplesZero = await ResearchResult.findAll({
            where: { productId: 0 },
            limit: 5,
            raw: true
        });
        console.log("Samples with productId = 0:", samplesZero.map(s => ({ id: s.id, root_name: s.root_name, disease: s.disease, calculated_dw: s.calculated_dw, article_number: s.article_number })));

        // Check if there are unsorted products
        const sampleRecords = await ResearchResult.findAll({
            limit: 20,
            order: [['id', 'ASC']],
            raw: true
        });
        console.log("First 20 records by DB id:");
        console.table(sampleRecords.map(r => ({
            id: r.id,
            productId: r.productId,
            root_name: r.root_name,
            diseaseId: r.diseaseId,
            disease: r.disease,
            calculated_dw: r.calculated_dw,
            article_number: r.article_number
        })));

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await sequelize.close();
    }
}

check();
