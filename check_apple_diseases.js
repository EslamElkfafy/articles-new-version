const axios = require("axios");
const fs = require("fs");
const path = require("path");

const NCBI_SEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const API_KEY = "b587f1cf996207071196b22c8418b7259607";

function generateQueries(productMesh, diseaseMesh) {
    const q1 = `("${productMesh}"[Mesh] AND "${productMesh}/therapeutic use"[Mesh] NOT "${productMesh}/adverse effects"[Mesh]) AND ("${diseaseMesh}/diet therapy"[Mesh] OR "${diseaseMesh}/drug therapy"[Mesh] OR "${diseaseMesh}/prevention and control"[Mesh] OR "${diseaseMesh}/rehabilitation"[Mesh] OR "${diseaseMesh}/therapy"[Mesh])`;
    const q2 = `("${productMesh}"[Mesh] NOT "${productMesh}/adverse effects"[Mesh]) AND ("${diseaseMesh}/diet therapy"[Mesh] OR "${diseaseMesh}/drug therapy"[Mesh] OR "${diseaseMesh}/prevention and control"[Mesh] OR "${diseaseMesh}/rehabilitation"[Mesh] OR "${diseaseMesh}/therapy"[Mesh])`;
    const q3 = `("${productMesh}" NOT "adverse effects"[Subheading]) AND ("${diseaseMesh}/diet therapy" OR "${diseaseMesh}/drug therapy" OR "${diseaseMesh}/prevention and control" OR "${diseaseMesh}/rehabilitation" OR "${diseaseMesh}/therapy")`;
    return { q1, q2, q3 };
}

async function searchPubMed(query) {
    try {
        const url = `${NCBI_SEARCH_URL}?db=pubmed&term=${encodeURIComponent(query)}&retmode=json&api_key=${API_KEY}`;
        const res = await axios.get(url);
        return parseInt(res.data.esearchresult.count) || 0;
    } catch (error) {
        return 0;
    }
}

async function main() {
    const product = "Apple";
    console.log(`🔍 Checking PubMed article counts for product "${product}" against all diseases...\n`);
    
    const diseases = JSON.parse(fs.readFileSync("diseases_msh-2.json", "utf-8"));
    let activeCount = 0;
    
    for (let i = 0; i < diseases.length; i++) {
        const disease = diseases[i];
        if (!disease["Best MeSH"]) {
            console.log(`[${i+1}/${diseases.length}] Disease: ID ${disease.id} -> SKIPPED (No MeSH)`);
            continue;
        }

        const queries = generateQueries(product, disease["Best MeSH"]);
        
        let count = 0;
        let queryUsed = "None";
        
        count = await searchPubMed(queries.q1);
        if (count > 0) {
            queryUsed = "Q1 (MeSH Therapeutic)";
        } else {
            count = await searchPubMed(queries.q2);
            if (count > 0) {
                queryUsed = "Q2 (MeSH standard)";
            } else {
                count = await searchPubMed(queries.q3);
                if (count > 0) {
                    queryUsed = "Q3 (Text Fallback)";
                }
            }
        }
        
        if (count > 0) {
            activeCount++;
        }
        
        console.log(`[${i+1}/${diseases.length}] Disease: ${disease["Best MeSH"]} -> Articles found: ${count} (${queryUsed})`);
        
        // Wait 200ms to avoid NCBI rate limit
        await new Promise(r => setTimeout(r, 200));
    }
    
    console.log(`\n📊 Summary: Found ${activeCount} active diseases and ${diseases.length - activeCount} empty diseases for "${product}".`);
}

main();
