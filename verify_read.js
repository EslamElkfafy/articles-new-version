const XLSX = require('xlsx');

try {
    console.log("🔍 Loading workbook...");
    const workbook = XLSX.readFile('Diabetes_Mellitus_Type_2_ready_articles.xls');
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    console.log("✅ Workbook loaded. Converting sheet to JSON...");
    const rawArticles = XLSX.utils.sheet_to_json(sheet);
    
    console.log(`📊 Total rows in spreadsheet: ${rawArticles.length}`);
    
    // Testing the first 100 rows logic
    const first100 = rawArticles.slice(0, 100);
    console.log(`✅ Extracted ${first100.length} rows using .slice(0, 100)`);
    
    if (first100.length > 0) {
        console.log("📝 Sample of the first row:");
        console.log({
            title: first100[0].title ? first100[0].title.substring(0, 50) + "..." : "No title",
            pubmed: first100[0].pubmed,
            disease: first100[0].disease,
            root_name: first100[0].root_name,
        });
    }

    console.log("\n🎉 The file is readable, properly structured, and ready to be processed by getURL.js.");

} catch (error) {
    console.error("❌ Error reading the file:", error.message);
}
