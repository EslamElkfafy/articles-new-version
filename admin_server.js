const express = require('express');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { sequelize, Item, ResearchResult } = require('./models/all');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const FULL_ROOTS_PATH = path.join(__dirname, 'Full-Roots.json');
const ROOTS_DATA_PATH = path.join(__dirname, 'roots-data.json');

// Helper to normalize plurals to singular forms
function getSingularForm(word) {
    if (!word) return "";
    let clean = word.toLowerCase().trim();
    if (clean.endsWith('ies')) {
        return clean.slice(0, -3) + 'y';
    }
    if (clean.endsWith('es')) {
        const stem = clean.slice(0, -2);
        if (stem.endsWith('ch') || stem.endsWith('sh') || stem.endsWith('x') || stem.endsWith('s') || stem.endsWith('z') || stem.endsWith('o')) {
            return stem;
        }
        if (clean.endsWith('s')) {
            return clean.slice(0, -1);
        }
    }
    if (clean.endsWith('s') && !clean.endsWith('ss')) {
        return clean.slice(0, -1);
    }
    return clean;
}

// Helper to check if two names are similar (matching singular forms or one contains the other as a whole word)
function isSimilar(name1, name2) {
    if (!name1 || !name2) return false;
    const s1 = getSingularForm(name1);
    const s2 = getSingularForm(name2);
    
    if (s1 === s2) return true;

    const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRegex = (word) => new RegExp('\\b' + escapeRegExp(word) + '\\b', 'i');
    
    const r1 = wordRegex(s2);
    const r2 = wordRegex(s1);
    
    return r1.test(s1) || r2.test(s2);
}

// Helper to write JSON files atomically
function saveJsonAtomically(filePath, data) {
    const tempPath = filePath + '.tmp';
    try {
        fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tempPath, filePath);
    } catch (e) {
        console.error(`❌ Failed to write JSON atomically to ${filePath}:`, e);
        throw e;
    }
}

// Load and Parse JSON helper
function loadJsonFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return [];
    }
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.error(`❌ Failed to read JSON from ${filePath}:`, e);
        return [];
    }
}

// Synchronize database with Full-Roots.json if empty
async function syncDatabaseIfEmpty() {
    try {
        await sequelize.authenticate();
        console.log('✅ Connected to database.');

        // Safe database migration to revert to id as primary key and introduce productId
        try {
            const tableInfo = await sequelize.getQueryInterface().describeTable('items');
            
            // 1. If db_id column exists, revert it
            if (tableInfo.db_id) {
                console.log('🔄 Reverting items table schema: removing db_id and restoring id as primary key...');
                await sequelize.query('ALTER TABLE items DROP CONSTRAINT IF EXISTS items_pkey CASCADE;');
                await sequelize.query('ALTER TABLE items DROP COLUMN IF EXISTS db_id;');
                await sequelize.query('ALTER TABLE items ADD CONSTRAINT items_pkey PRIMARY KEY (id);');
            }

            // 2. If productId column does not exist, add it and populate it with id values
            if (!tableInfo.productid && !tableInfo.productId) {
                console.log('🔄 Adding productId column to items table...');
                await sequelize.query('ALTER TABLE items ADD COLUMN "productId" INTEGER;');
                await sequelize.query('UPDATE items SET "productId" = id;');
            }
        } catch (err) {
            console.log('ℹ️ Migration check info:', err.message);
        }

        // Alter schema to create best_mesh_match and processing_status columns if missing
        await sequelize.sync({ alter: true });
        console.log('📦 Database schema synced (alter mode).');

        const dbCount = await Item.count();
        const fullRoots = loadJsonFile(FULL_ROOTS_PATH);

        if (dbCount === 0) {
            console.log('🔄 Database items table is empty. Initializing from Full-Roots.json...');
            
            if (fullRoots.length > 0) {
                const itemsToInsert = fullRoots.map(item => ({
                    id: parseInt(item.id, 10),
                    productId: parseInt(item.id, 10),
                    name: item.Root || item.name_en || 'Unknown',
                    best_mesh_match: item["Best MeSH match"] || item.Root || item.name_en || '',
                    processing_status: 'Completed'
                }));
                
                await Item.bulkCreate(itemsToInsert);
                console.log(`✅ Successfully loaded ${itemsToInsert.length} items into database table.`);
            } else {
                console.warn('⚠️ Full-Roots.json has no entries. Skipping initial database load.');
            }
        } else {
            console.log(`ℹ️ Database items table has ${dbCount} records. Verifying columns and values...`);
            
            // Check for missing best_mesh_match and backfill
            const { Op } = require("sequelize");
            const itemsToBackfill = await Item.findAll({
                where: {
                    [Op.or]: [
                        { best_mesh_match: '' },
                        { best_mesh_match: null }
                    ]
                }
            });
            
            if (itemsToBackfill.length > 0) {
                console.log(`🔄 Backfilling MeSH matches and status for ${itemsToBackfill.length} items...`);
                for (const dbItem of itemsToBackfill) {
                    const matchedRoot = fullRoots.find(r => parseInt(r.id, 10) === dbItem.id);
                    await dbItem.update({
                        best_mesh_match: (matchedRoot && matchedRoot["Best MeSH match"]) ? matchedRoot["Best MeSH match"] : dbItem.name,
                        processing_status: 'Completed'
                    });
                }
                console.log('✅ Backfilling completed.');
            }

            // Reset any items that were left in 'Processing' state back to 'Failed' (since they were interrupted by server stop)
            const interruptedCount = await Item.update(
                { processing_status: 'Failed' },
                { where: { processing_status: 'Processing' } }
            );
            if (interruptedCount[0] > 0) {
                console.log(`⚠️ Reset ${interruptedCount[0]} interrupted processing items back to 'Failed'.`);
            }
        }
    } catch (err) {
        console.error('❌ Database initialization error:', err.message);
    }
}

// API Routes

// 1. GET all items
app.get('/api/items', async (req, res) => {
    try {
        const items = await Item.findAll({
            order: [['productId', 'ASC'], ['id', 'ASC']]
        });
        res.json(items);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch items from database.' });
    }
});

// 2. POST create new item
app.post('/api/items', async (req, res) => {
    const { name, best_mesh_match } = req.body;
    
    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'English name is required.' });
    }
    if (!best_mesh_match || !best_mesh_match.trim()) {
        return res.status(400).json({ error: 'Best MeSH match is required.' });
    }

    try {
        // Fetch all items to perform robust singular/plural duplicate checks in JS
        const allItems = await Item.findAll();
        const cleanNewName = getSingularForm(name);

        const duplicate = allItems.find(item => {
            const dbNameSingular = getSingularForm(item.name);
            return dbNameSingular === cleanNewName;
        });

        if (duplicate) {
            return res.status(400).json({ error: `An item similar to this (${duplicate.name}) already exists.` });
        }
        const fullRoots = loadJsonFile(FULL_ROOTS_PATH);
        const rootsData = loadJsonFile(ROOTS_DATA_PATH);

        // Find max ID across all stores
        const dbMaxId = (await Item.max('productId')) || 0;
        const fileMaxId1 = fullRoots.reduce((max, item) => Math.max(max, parseInt(item.id, 10) || 0), 0);
        const fileMaxId2 = rootsData.reduce((max, item) => Math.max(max, parseInt(item.id, 10) || 0), 0);
        const nextId = Math.max(dbMaxId, fileMaxId1, fileMaxId2) + 1;

        // 1. Create in DB with status Pending
        const newItem = await Item.create({
            productId: nextId,
            name: name.trim(),
            best_mesh_match: best_mesh_match.trim(),
            processing_status: 'Pending'
        });

        // 2. Append to Full-Roots.json
        const newFullItem = {
            record: "",
            id: String(nextId),
            category_id: "1",
            root_ID: String(nextId),
            Root: name.trim(),
            name_en: name.trim(),
            Scientific_Name_en: "",
            dw: "",
            dcw: "",
            odw: "",
            tac: "",
            calories_per_gram: "",
            is_root: "TRUE",
            rate: "",
            Result: "",
            "Best MeSH match": best_mesh_match.trim(),
            Query: "",
            "Query results count": "",
            "First Query": "",
            Second: "",
            Third: ""
        };
        fullRoots.push(newFullItem);
        saveJsonAtomically(FULL_ROOTS_PATH, fullRoots);

        // 3. Append to roots-data.json
        const newRootsDataItem = {
            id: String(nextId),
            category_id: "1",
            root_ID: String(nextId),
            Root: name.trim(),
            name_en: name.trim(),
            Scientific_Name_en: null,
            dw: null,
            dcw: null,
            odw: null,
            tac: null,
            calories_per_gram: null,
            is_root: "TRUE",
            rate: null,
            Result: null,
            "Best MeSH match": best_mesh_match.trim(),
            Query: "",
            "Query results count": "",
            "machine q1 result": null,
            "First Query": "",
            Second: "",
            Third: ""
        };
        rootsData.push(newRootsDataItem);
        saveJsonAtomically(ROOTS_DATA_PATH, rootsData);

        // 4. Trigger single-product pipeline execution in background
        const { processSingleProduct } = require('./add-single-product');
        processSingleProduct(newRootsDataItem, false, false)
            .then(() => console.log(`🚀 Pipeline completed for background task ID ${nextId}`))
            .catch(err => console.error(`❌ Pipeline failed for background task ID ${nextId}:`, err.message));

        // Clear global cache so pipeline resolves new mappings correctly
        global.fullRootsIndex = null;
        global.aiToFullMappings = null;

        res.status(201).json(newItem);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create item.' });
    }
});

// 3. PUT update existing item
app.put('/api/items/:id', async (req, res) => {
    const dbId = parseInt(req.params.id, 10);
    const { productId, name, best_mesh_match } = req.body;
    const newProductId = productId ? parseInt(productId, 10) : null;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'English name is required.' });
    }
    if (!best_mesh_match || !best_mesh_match.trim()) {
        return res.status(400).json({ error: 'Best MeSH match is required.' });
    }
    if (newProductId === null || isNaN(newProductId) || newProductId <= 0) {
        return res.status(400).json({ error: 'Valid item ID is required.' });
    }

    try {
        const itemInDb = await Item.findByPk(dbId);
        if (!itemInDb) {
            return res.status(404).json({ error: 'Item not found.' });
        }

        // Fetch all items to perform duplicate name checks
        const allItems = await Item.findAll();
        const cleanNewName = getSingularForm(name);

        const duplicate = allItems.find(item => {
            if (item.id === dbId) return false;
            const dbNameSingular = getSingularForm(item.name);
            return dbNameSingular === cleanNewName;
        });

        if (duplicate) {
            return res.status(400).json({ error: `Another item similar to this (${duplicate.name}) already exists.` });
        }

        const nameChanged = (name.trim() !== itemInDb.name);
        const meshChanged = (best_mesh_match.trim() !== itemInDb.best_mesh_match);
        const idChanged = (newProductId !== itemInDb.productId);

        const oldProductId = itemInDb.productId;

        // Stop any running pipeline for the record
        const activeRun = global.activeSingleProductRuns?.get(String(oldProductId));
        if (activeRun) {
            activeRun.stopRequested = true;
        }

        if (nameChanged || meshChanged) {
            // Trigger processing pipeline
            // Update in DB and set status to Pending
            await Item.update({
                productId: newProductId,
                name: name.trim(),
                best_mesh_match: best_mesh_match.trim(),
                processing_status: 'Pending'
            }, {
                where: { id: dbId }
            });

            // Delete old research results since name/mesh changed
            await ResearchResult.destroy({
                where: { productId: oldProductId }
            });

            // Trigger single-product pipeline execution in background for newProductId
            const rootsDataItem = {
                id: String(newProductId),
                Root: name.trim(),
                name_en: name.trim(),
                "Best MeSH match": best_mesh_match.trim(),
                odw: ""
            };

            const { processSingleProduct } = require('./add-single-product');
            processSingleProduct(rootsDataItem, false, false)
                .then(() => console.log(`🚀 Pipeline completed for updated task ID ${newProductId}`))
                .catch(err => console.error(`❌ Pipeline failed for updated task ID ${newProductId}:`, err.message));
        } else {
            // ONLY ID or non-pipeline fields changed (or no changes)
            // Just update in DB, keep original processing_status
            await Item.update({
                productId: newProductId,
                name: name.trim(),
                best_mesh_match: best_mesh_match.trim()
            }, {
                where: { id: dbId }
            });

            // If ID changed, update all research results to point to the new ID
            if (idChanged) {
                await ResearchResult.update({
                    productId: newProductId
                }, {
                    where: { productId: oldProductId }
                });
            }
        }

        // Update in Full-Roots.json
        let fullRoots = loadJsonFile(FULL_ROOTS_PATH);
        const fullItem = fullRoots.find(item => parseInt(item.id, 10) === oldProductId && item.Root === itemInDb.name);
        if (fullItem) {
            fullItem.id = String(newProductId);
            fullItem.root_ID = String(newProductId);
            fullItem.Root = name.trim();
            fullItem.name_en = name.trim();
            fullItem["Best MeSH match"] = best_mesh_match.trim();
        } else {
            fullRoots.push({
                record: "",
                id: String(newProductId),
                category_id: "1",
                root_ID: String(newProductId),
                Root: name.trim(),
                name_en: name.trim(),
                Scientific_Name_en: "",
                dw: "",
                dcw: "",
                odw: "",
                tac: "",
                calories_per_gram: "",
                is_root: "TRUE",
                rate: "",
                Result: "",
                "Best MeSH match": best_mesh_match.trim(),
                Query: "",
                "Query results count": "",
                "First Query": "",
                Second: "",
                Third: ""
            });
        }
        saveJsonAtomically(FULL_ROOTS_PATH, fullRoots);

        // Update in roots-data.json
        let rootsData = loadJsonFile(ROOTS_DATA_PATH);
        const rootsItem = rootsData.find(item => parseInt(item.id, 10) === oldProductId && item.Root === itemInDb.name);
        if (rootsItem) {
            rootsItem.id = String(newProductId);
            rootsItem.root_ID = String(newProductId);
            rootsItem.Root = name.trim();
            rootsItem.name_en = name.trim();
            rootsItem["Best MeSH match"] = best_mesh_match.trim();
        } else {
            rootsData.push({
                id: String(newProductId),
                category_id: "1",
                root_ID: String(newProductId),
                Root: name.trim(),
                name_en: name.trim(),
                Scientific_Name_en: null,
                dw: null,
                dcw: null,
                odw: null,
                tac: null,
                calories_per_gram: null,
                is_root: "TRUE",
                rate: null,
                Result: null,
                "Best MeSH match": best_mesh_match.trim(),
                Query: "",
                "Query results count": "",
                "machine q1 result": null,
                "First Query": "",
                Second: "",
                Third: ""
            });
        }
        saveJsonAtomically(ROOTS_DATA_PATH, rootsData);

        // Clear global cache so pipeline resolves new mappings correctly
        global.fullRootsIndex = null;
        global.aiToFullMappings = null;

        res.json({ id: newProductId, name: name.trim(), best_mesh_match: best_mesh_match.trim(), processing_status: (nameChanged || meshChanged) ? 'Pending' : itemInDb.processing_status });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update item.' });
    }
});

// 3.5 POST run manual pipeline for existing item
app.post('/api/items/:id/run', async (req, res) => {
    const dbId = parseInt(req.params.id, 10);

    try {
        const item = await Item.findByPk(dbId);
        if (!item) {
            return res.status(404).json({ error: 'Item not found.' });
        }

        if (item.processing_status === 'Processing') {
            return res.status(400).json({ error: 'Pipeline is already running for this item.' });
        }

        const rootsDataItem = {
            id: String(item.productId),
            Root: item.name,
            "Best MeSH match": item.best_mesh_match || item.name,
            odw: ""
        };

        // Trigger in background
        const { processSingleProduct } = require('./add-single-product');
        processSingleProduct(rootsDataItem, false, false)
            .then(() => console.log(`🚀 Manual pipeline completed for ID ${item.productId}`))
            .catch(err => console.error(`❌ Manual pipeline failed for ID ${item.productId}:`, err.message));

        res.json({ success: true, message: 'Pipeline run initiated in background.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to trigger pipeline run.' });
    }
});

// 3.6 POST stop running pipeline for existing item
app.post('/api/items/:id/stop', async (req, res) => {
    const dbId = parseInt(req.params.id, 10);

    try {
        const item = await Item.findByPk(dbId);
        if (!item) {
            return res.status(404).json({ error: 'Item not found.' });
        }

        const run = global.activeSingleProductRuns?.get(String(item.productId));
        if (!run) {
            return res.status(400).json({ error: 'Pipeline is not running for this item.' });
        }

        run.stopRequested = true;
        
        // Update DB status immediately
        await item.update({ processing_status: 'Failed' });

        res.json({ success: true, message: 'Pipeline stop requested.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to stop pipeline.' });
    }
});

// 4. DELETE item
app.delete('/api/items/:id', async (req, res) => {
    const dbId = parseInt(req.params.id, 10);

    try {
        const itemInDb = await Item.findByPk(dbId);
        if (!itemInDb) {
            return res.status(404).json({ error: 'Item not found.' });
        }

        const logicalId = itemInDb.productId;
        const itemName = itemInDb.name;

        // 1. Delete from DB
        await Item.destroy({
            where: { id: dbId }
        });

        // 2. Check if there are other items with this logical ID remaining
        const otherItemsWithSameId = await Item.count({
            where: { productId: logicalId }
        });

        // Only update research results referencing this item to 0 if no other duplicates exist
        if (otherItemsWithSameId === 0) {
            await ResearchResult.update({
                productId: 0
            }, {
                where: { productId: logicalId }
            });
        }

        // 3. Delete from Full-Roots.json (matching both ID and Root name to target this specific duplicate)
        const fullRoots = loadJsonFile(FULL_ROOTS_PATH);
        const filteredFullRoots = fullRoots.filter(item => !(parseInt(item.id, 10) === logicalId && item.Root === itemName));
        saveJsonAtomically(FULL_ROOTS_PATH, filteredFullRoots);

        // 4. Delete from roots-data.json
        const rootsData = loadJsonFile(ROOTS_DATA_PATH);
        const filteredRootsData = rootsData.filter(item => !(parseInt(item.id, 10) === logicalId && item.Root === itemName));
        saveJsonAtomically(ROOTS_DATA_PATH, filteredRootsData);

        // Clear global cache so pipeline resolves new mappings correctly
        global.fullRootsIndex = null;
        global.aiToFullMappings = null;

        res.json({ success: true, message: `Successfully deleted item ID ${logicalId}` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete item.' });
    }
});

// Start Express App
app.listen(PORT, async () => {
    console.log(`🚀 Admin Server running on http://localhost:${PORT}`);
    await syncDatabaseIfEmpty();
});
