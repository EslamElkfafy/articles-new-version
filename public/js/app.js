// Application State
let itemsState = [];
let deleteTargetId = null;

// DOM Elements
const totalRootsCount = document.getElementById('total-roots-count');
const itemsTableBody = document.getElementById('items-table-body');
const searchInput = document.getElementById('search-input');
const noResults = document.getElementById('no-results');

const addModal = document.getElementById('add-modal');
const editModal = document.getElementById('edit-modal');
const deleteModal = document.getElementById('delete-modal');

const addForm = document.getElementById('add-form');
const editForm = document.getElementById('edit-form');

const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
const deleteItemNameLabel = document.getElementById('delete-item-name');

// 1. Fetch Items from Server
async function fetchItems() {
    try {
        setTableLoading(true);
        const res = await fetch('/api/items');
        if (!res.ok) throw new Error('Failed to load items.');
        
        itemsState = await res.json();
        renderTable();
        updateKPI();
    } catch (err) {
        console.error(err);
        showToast('Error loading roots: ' + err.message, 'error');
        itemsTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger-color); padding: 32px;"><i class="fa-solid fa-circle-exclamation"></i> Error loading database records.</td></tr>`;
    }
}

// 2. Render Table Rows
function renderTable(filterText = '') {
    const cleanFilter = filterText.toLowerCase().trim();
    
    const filteredItems = itemsState.filter(item => {
        if (!cleanFilter) return true;
        const idStr = String(item.id);
        const nameStr = (item.name || '').toLowerCase();
        const arabicStr = (item.arabic_name || '').toLowerCase();
        return idStr.includes(cleanFilter) || nameStr.includes(cleanFilter) || arabicStr.includes(cleanFilter);
    });

    itemsTableBody.innerHTML = '';

    if (filteredItems.length === 0) {
        noResults.classList.remove('hidden');
        document.getElementById('items-table').classList.add('hidden');
        return;
    }

    noResults.classList.add('hidden');
    document.getElementById('items-table').classList.remove('hidden');

    filteredItems.forEach(item => {
        const row = document.createElement('tr');
        
        // Find best MeSH match from JSON state if not stored in DB, or show fallback
        const meshMatch = item.best_mesh_match || item.name || '-';

        row.innerHTML = `
            <td><strong>${item.id}</strong></td>
            <td>${escapeHtml(item.name)}</td>
            <td dir="rtl" style="text-align: right; font-weight: 500;">${escapeHtml(item.arabic_name)}</td>
            <td><code class="mesh-code">${escapeHtml(meshMatch)}</code></td>
            <td class="actions-cell">
                <button class="btn-action edit-action" title="Edit Root" onclick="openEditModal(${item.id})">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn-action delete-action" title="Delete Root" onclick="openDeleteModal(${item.id})">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        itemsTableBody.appendChild(row);
    });
}

// 3. Update KPI Counters
function updateKPI() {
    totalRootsCount.textContent = itemsState.length;
}

// Table loading helper
function setTableLoading(loading) {
    if (loading) {
        itemsTableBody.innerHTML = `
            <tr>
                <td colspan="5" class="table-loading">
                    <div class="spinner"></div> Loading roots...
                </td>
            </tr>
        `;
    }
}

// HTML Escaper to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// 4. Modal Triggers & Controls
document.getElementById('add-btn').addEventListener('click', () => {
    addForm.reset();
    openModal(addModal);
});

// Setup Close buttons
document.querySelectorAll('.close-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetModalId = btn.getAttribute('data-modal');
        closeModal(document.getElementById(targetModalId));
    });
});

// Close modal if clicked outside card overlay
window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        closeModal(e.target);
    }
});

function openModal(modal) {
    modal.classList.remove('hidden');
    // Focus first input field inside modal
    const firstInput = modal.querySelector('input');
    if (firstInput) firstInput.focus();
}

function closeModal(modal) {
    modal.classList.add('hidden');
}

// 5. Submit Add Form
addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('add-name').value;
    const arabic_name = document.getElementById('add-arabic').value;
    const best_mesh_match = document.getElementById('add-mesh').value;

    try {
        const res = await fetch('/api/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, arabic_name, best_mesh_match })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save product root.');

        closeModal(addModal);
        showToast('Root item added successfully!', 'success');
        fetchItems(); // Reload
    } catch (err) {
        showToast(err.message, 'error');
    }
});

// 6. Edit Actions
function openEditModal(id) {
    const item = itemsState.find(i => i.id === id);
    if (!item) return;

    document.getElementById('edit-id').value = item.id;
    document.getElementById('edit-name').value = item.name;
    document.getElementById('edit-arabic').value = item.arabic_name;
    
    // Fallback mesh match
    document.getElementById('edit-mesh').value = item.best_mesh_match || item.name || '';

    openModal(editModal);
}

editForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('edit-id').value;
    const name = document.getElementById('edit-name').value;
    const arabic_name = document.getElementById('edit-arabic').value;
    const best_mesh_match = document.getElementById('edit-mesh').value;

    try {
        const res = await fetch(`/api/items/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, arabic_name, best_mesh_match })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update changes.');

        closeModal(editModal);
        showToast('Root item updated successfully!', 'success');
        fetchItems(); // Reload
    } catch (err) {
        showToast(err.message, 'error');
    }
});

// 7. Delete Actions
function openDeleteModal(id) {
    const item = itemsState.find(i => i.id === id);
    if (!item) return;

    deleteTargetId = id;
    deleteItemNameLabel.textContent = `${item.name} (${item.arabic_name})`;
    openModal(deleteModal);
}

confirmDeleteBtn.addEventListener('click', async () => {
    if (!deleteTargetId) return;

    try {
        const res = await fetch(`/api/items/${deleteTargetId}`, {
            method: 'DELETE'
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete item.');

        closeModal(deleteModal);
        showToast('Root item deleted successfully!', 'success');
        deleteTargetId = null;
        fetchItems(); // Reload
    } catch (err) {
        showToast(err.message, 'error');
    }
});

// 8. Instant Search Filtering
document.getElementById('search-input').addEventListener('input', (e) => {
    renderTable(e.target.value);
});

// 9. Toast Notifications
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 
        '<i class="fa-solid fa-circle-check"></i>' : 
        '<i class="fa-solid fa-circle-exclamation"></i>';

    toast.innerHTML = `${icon} <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    // Auto-remove toast after 3.5 seconds
    setTimeout(() => {
        toast.style.animation = 'toastSlideIn 0.3s ease reverse forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// Initialize App
window.addEventListener('DOMContentLoaded', fetchItems);
