require("dotenv").config();
const { sequelize, Item } = require("./models/all");

async function check() {
    try {
        await sequelize.authenticate();
        console.log("Connected to DB successfully");
        const count = await Item.count();
        console.log("Total items in database items table:", count);
        if (count > 0) {
            const samples = await Item.findAll({ limit: 5, raw: true });
            console.log("Sample items:", samples);
        }
    } catch (e) {
        console.error("Error checking items table:", e);
    } finally {
        await sequelize.close();
    }
}

check();
