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

        const dbCount = await Item.count();
        if (dbCount === 0) {
            console.log('🔄 Database items table is empty. Initializing from Full-Roots.json...');
            const fullRoots = loadJsonFile(FULL_ROOTS_PATH);
            
            if (fullRoots.length > 0) {
                const itemsToInsert = fullRoots.map(item => ({
                    id: parseInt(item.id, 10),
                    name: item.Root || item.name_en || 'Unknown',
                    arabic_name: item.arabic_name || item.Root || item.name_en || 'غير معروف'
                }));
                
                await Item.bulkCreate(itemsToInsert);
                console.log(`✅ Successfully loaded ${itemsToInsert.length} items into database table.`);
            } else {
                console.warn('⚠️ Full-Roots.json has no entries. Skipping initial database load.');
            }
        } else {
            console.log(`ℹ️ Database items table has ${dbCount} records. No sync needed.`);
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
            order: [['id', 'ASC']]
        });
        res.json(items);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch items from database.' });
    }
});

// 2. POST create new item
app.post('/api/items', async (req, res) => {
    const { name, arabic_name, best_mesh_match } = req.body;
    
    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'English name is required.' });
    }
    if (!arabic_name || !arabic_name.trim()) {
        return res.status(400).json({ error: 'Arabic name is required.' });
    }

    try {
        const fullRoots = loadJsonFile(FULL_ROOTS_PATH);
        const rootsData = loadJsonFile(ROOTS_DATA_PATH);

        // Find max ID across all stores
        const dbMaxId = (await Item.max('id')) || 0;
        const fileMaxId1 = fullRoots.reduce((max, item) => Math.max(max, parseInt(item.id, 10) || 0), 0);
        const fileMaxId2 = rootsData.reduce((max, item) => Math.max(max, parseInt(item.id, 10) || 0), 0);
        const nextId = Math.max(dbMaxId, fileMaxId1, fileMaxId2) + 1;

        // 1. Create in DB
        const newItem = await Item.create({
            id: nextId,
            name: name.trim(),
            arabic_name: arabic_name.trim()
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
            "Best MeSH match": (best_mesh_match && best_mesh_match.trim()) ? best_mesh_match.trim() : name.trim(),
            Query: "",
            "Query results count": "",
            "First Query": "",
            Second: "",
            Third: "",
            arabic_name: arabic_name.trim() // custom preserve
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
            "Best MeSH match": (best_mesh_match && best_mesh_match.trim()) ? best_mesh_match.trim() : name.trim(),
            Query: "",
            "Query results count": "",
            "machine q1 result": null,
            "First Query": "",
            Second: "",
            Third: "",
            arabic_name: arabic_name.trim() // custom preserve
        };
        rootsData.push(newRootsDataItem);
        saveJsonAtomically(ROOTS_DATA_PATH, rootsData);

        res.status(201).json(newItem);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create item.' });
    }
});

// 3. PUT update existing item
app.put('/api/items/:id', async (req, res) => {
    const itemId = parseInt(req.params.id, 10);
    const { name, arabic_name, best_mesh_match } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'English name is required.' });
    }
    if (!arabic_name || !arabic_name.trim()) {
        return res.status(400).json({ error: 'Arabic name is required.' });
    }

    try {
        const itemInDb = await Item.findByPk(itemId);
        if (!itemInDb) {
            return res.status(404).json({ error: 'Item not found.' });
        }

        // 1. Update in DB
        await Item.update({
            name: name.trim(),
            arabic_name: arabic_name.trim()
        }, {
            where: { id: itemId }
        });

        // 2. Update in Full-Roots.json
        const fullRoots = loadJsonFile(FULL_ROOTS_PATH);
        const fullItem = fullRoots.find(item => parseInt(item.id, 10) === itemId);
        if (fullItem) {
            fullItem.Root = name.trim();
            fullItem.name_en = name.trim();
            fullItem.arabic_name = arabic_name.trim();
            if (best_mesh_match !== undefined) {
                fullItem["Best MeSH match"] = best_mesh_match.trim() || name.trim();
            }
            saveJsonAtomically(FULL_ROOTS_PATH, fullRoots);
        }

        // 3. Update in roots-data.json
        const rootsData = loadJsonFile(ROOTS_DATA_PATH);
        const rootsItem = rootsData.find(item => parseInt(item.id, 10) === itemId);
        if (rootsItem) {
            rootsItem.Root = name.trim();
            rootsItem.name_en = name.trim();
            rootsItem.arabic_name = arabic_name.trim();
            if (best_mesh_match !== undefined) {
                rootsItem["Best MeSH match"] = best_mesh_match.trim() || name.trim();
            }
            saveJsonAtomically(ROOTS_DATA_PATH, rootsData);
        }

        res.json({ id: itemId, name: name.trim(), arabic_name: arabic_name.trim() });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update item.' });
    }
});

// 4. DELETE item
app.delete('/api/items/:id', async (req, res) => {
    const itemId = parseInt(req.params.id, 10);

    try {
        const itemInDb = await Item.findByPk(itemId);
        if (!itemInDb) {
            return res.status(404).json({ error: 'Item not found.' });
        }

        // 1. Delete from DB
        await Item.destroy({
            where: { id: itemId }
        });

        // 2. Set research results referencing this item to 0
        await ResearchResult.update({
            productId: 0
        }, {
            where: { productId: itemId }
        });

        // 3. Delete from Full-Roots.json
        const fullRoots = loadJsonFile(FULL_ROOTS_PATH);
        const filteredFullRoots = fullRoots.filter(item => parseInt(item.id, 10) !== itemId);
        saveJsonAtomically(FULL_ROOTS_PATH, filteredFullRoots);

        // 4. Delete from roots-data.json
        const rootsData = loadJsonFile(ROOTS_DATA_PATH);
        const filteredRootsData = rootsData.filter(item => parseInt(item.id, 10) !== itemId);
        saveJsonAtomically(ROOTS_DATA_PATH, filteredRootsData);

        res.json({ success: true, message: `Successfully deleted item ID ${itemId}` });
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
