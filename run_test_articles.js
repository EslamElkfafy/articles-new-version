const { getURL } = require('./getURL');
const { sequelize } = require('./models/all');

async function testTenArticles() {
    console.log("Starting test on 10 articles...");
    try {
        await sequelize.authenticate();
        console.log("✅ Connected to DB");
        await sequelize.sync({ alter: true });
        
        // Construct a dummy payload with 10 real PMIDs from Diabetes_Mellitus_Type_2_ready_articles.xls
        const dummyData = [{
            id: 99999, // dummy product id
            root_name: "Blackberry",
            disease_id: 28,
            disease_name: "Diabetes Mellitus, Type 2",
            articles_count: 10,
            category: "ready",
            calculated_dw: 48,
            all_product_names: "Blackberry",
            articles: [
                {
                    title: "Attenuation of Postmeal Metabolic Indices with Red Raspberries in Individuals at Risk for Diabetes: A Randomized Controlled Trial.",
                    pubmed: "https://pubmed.ncbi.nlm.nih.gov/30767409/",
                    PMID: "30767409",
                    pubtypes: "Journal Article, Randomized Controlled Trial",
                    rate: 4,
                    pmc: null
                },
                {
                    title: "Effects of Dietary Red Raspberry Consumption on Pre-Diabetes and Type 2 Diabetes Mellitus Parameters.",
                    pubmed: "https://pubmed.ncbi.nlm.nih.gov/34501954/",
                    PMID: "34501954",
                    pubtypes: "Journal Article, Review",
                    rate: 2,
                    pmc: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8431376/"
                },
                {
                    title: "Evaluation of Rubus grandifolius L. (wild blackberries) activities targeting management of type-2 diabetes and obesity using in vitro models.",
                    pubmed: "https://pubmed.ncbi.nlm.nih.gov/30408537/",
                    PMID: "30408537",
                    pubtypes: "Journal Article",
                    rate: 0,
                    pmc: null
                },
                {
                    title: "Pelargonidin-3-O-glucoside Derived from Wild Raspberry Exerts Antihyperglycemic Effect by Inducing Autophagy and Modulating Gut Microbiota.",
                    pubmed: "https://pubmed.ncbi.nlm.nih.gov/31322351/",
                    PMID: "31322351",
                    pubtypes: "Journal Article",
                    rate: 0,
                    pmc: null
                },
                {
                    title: "Chinese Sweet Leaf Tea (Rubus suavissimus) Mitigates LPS-Induced Low-Grade Chronic Inflammation and Reduces the Risk of Metabolic Disorders in a C57BL/6J Mouse Model.",
                    pubmed: "https://pubmed.ncbi.nlm.nih.gov/31873011/",
                    PMID: "31873011",
                    pubtypes: "Journal Article",
                    rate: 0,
                    pmc: null
                },
                {
                    title: "Effects of red raspberry polyphenols and metabolites on the biomarkers of inflammation and insulin resistance in type 2 diabetes: a pilot study.",
                    pubmed: "https://pubmed.ncbi.nlm.nih.gov/35421887/",
                    PMID: "35421887",
                    pubtypes: "Journal Article",
                    rate: 0,
                    pmc: null
                },
                {
                    title: "The effect of the molecular weight of blackberry polysaccharides on gut microbiota modulation and hypoglycemic effect in vivo.",
                    pubmed: "https://pubmed.ncbi.nlm.nih.gov/39078268/",
                    PMID: "39078268",
                    pubtypes: "Journal Article",
                    rate: 0,
                    pmc: null
                },
                {
                    title: "Study on the Mechanism of Raspberry (Rubi fructus) in Treating Type 2 Diabetes Based on UPLC-Q-Exactive Orbitrap MS, Network Pharmacology, and Experimental Validation.",
                    pubmed: "https://pubmed.ncbi.nlm.nih.gov/39496506/",
                    PMID: "39496506",
                    pubtypes: "Journal Article",
                    rate: 0,
                    pmc: null
                },
                {
                    title: "Effects of blueberry and cranberry on type 2 diabetes parameters in individuals with or without diabetes: A systematic review and meta-analysis of randomized clinical trials.",
                    pubmed: "https://pubmed.ncbi.nlm.nih.gov/35282984/",
                    PMID: "35282984",
                    pubtypes: "Journal Article, Meta-Analysis",
                    rate: 5,
                    pmc: null
                },
                {
                    title: "Cranberries improve postprandial glucose excursions in type 2 diabetes.",
                    pubmed: "https://pubmed.ncbi.nlm.nih.gov/28748974/",
                    PMID: "28748974",
                    pubtypes: "Journal Article, Randomized Controlled Trial",
                    rate: 4,
                    pmc: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9473326/"
                }
            ]
        }];
        
        await getURL(dummyData);
        console.log("✅ Test finished.");
        
    } catch (error) {
        console.error("❌ Test error:", error);
    } finally {
        await sequelize.close();
    }
}

testTenArticles();
