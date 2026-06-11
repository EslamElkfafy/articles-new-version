const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize({
    dialect: "postgres",
    host: "localhost",
    username: process.env.DB_USERNAME || "postgres",
    password: process.env.DB_PASSWORD || "Eslam2002",
    database: process.env.DB_NAME || "medical_research",
    logging: false, // Disable SQL logs

});

const Item = sequelize.define('items', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.TEXT, allowNull: false },
    arabic_name: { type: DataTypes.TEXT, allowNull: false },
}, { timestamps: false });

const Disease = sequelize.define('diseases', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.TEXT, allowNull: false },
    code: { type: DataTypes.TEXT, allowNull: false },
    foundation_url: { type: DataTypes.TEXT, allowNull: true },
    icd_title: { type: DataTypes.TEXT, allowNull: true },
}, { timestamps: false });

const ResearchResult = sequelize.define('research_results', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    productId: { type: DataTypes.INTEGER },
    root_name: { type: DataTypes.TEXT },
    scientific_name: { type: DataTypes.TEXT },
    diseaseId: { type: DataTypes.INTEGER },
    disease: { type: DataTypes.TEXT },
    code: { type: DataTypes.TEXT },
    foundation_url: { type: DataTypes.TEXT },
    icd_title: { type: DataTypes.TEXT },
    articles_count: { type: DataTypes.INTEGER },
    category: { type: DataTypes.TEXT },
    calculated_dw: { type: DataTypes.FLOAT },
    article_number: { type: DataTypes.TEXT },
    title: { type: DataTypes.TEXT, allowNull: false },
    pubmed: { type: DataTypes.TEXT },
    PMID: { type: DataTypes.TEXT }, // Added raw PMID mapping
    doi: { type: DataTypes.TEXT },
    DOI: { type: DataTypes.TEXT }, // Added raw DOI mapping
    pmc: { type: DataTypes.TEXT },
    PMCID: { type: DataTypes.TEXT }, // Added raw PMCID mapping
    pubtypes: { type: DataTypes.TEXT },
    ai_pubtypes: { type: DataTypes.TEXT },
    rate: { type: DataTypes.INTEGER },
    disease_rates: { type: DataTypes.FLOAT },
    diseases_rate_all_null: { type: DataTypes.FLOAT },
    disease_rate_combination: { type: DataTypes.FLOAT },

    // Existing fields (kept for compatibility if needed, or can be removed if strictly replacing)
    name: { type: DataTypes.TEXT },
    // title: { type: DataTypes.TEXT, allowNull: false }, // Already included above
    // research_type: { type: DataTypes.TEXT },
    // weight: { type: DataTypes.INTEGER },
    // pmc_link: { type: DataTypes.TEXT },

    processing_status: { type: DataTypes.TEXT },

    // Removed Root causes 1 to 10 as per user request

    dynamic_root_causes: { type: DataTypes.JSON },

    labs: { type: DataTypes.JSON },

    createdAt: { type: DataTypes.DATE, allowNull: true },
    updatedAt: { type: DataTypes.DATE, allowNull: true },

}, { timestamps: true });

module.exports = {
    sequelize,
    Item,
    Disease,
    ResearchResult,
};
