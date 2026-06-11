const XLSX = require('xlsx');
const path = require('path');

try {
    const excelPath = path.join(__dirname, 'Diabetes_Mellitus_Type_2_ready_articles.xls');
    console.log("Loading workbook from:", excelPath);
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawArticles = XLSX.utils.sheet_to_json(sheet);
    if (rawArticles.length > 0) {
        console.log("Keys in Excel:", Object.keys(rawArticles[0]));
        console.log("Sample row:", rawArticles[0]);
    } else {
        console.log("Excel sheet is empty");
    }
} catch (error) {
    console.error("Error:", error);
}
