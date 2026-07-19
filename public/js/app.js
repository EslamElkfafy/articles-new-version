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
let pollTimeout = null;

async function fetchItems() {
    try {
        setTableLoading(itemsState.length === 0);
        const res = await fetch('/api/items');
        if (!res.ok) throw new Error('Failed to load items.');
        
        itemsState = await res.json();
        renderTable(searchInput ? searchInput.value : '');
        updateKPI();

        // Check if any item is in 'Processing' or 'Pending' state
        const hasProcessing = itemsState.some(item => {
            const status = (item.processing_status || '').toLowerCase();
            return status === 'processing' || status === 'pending';
        });
        
        if (pollTimeout) clearTimeout(pollTimeout);
        if (hasProcessing) {
            pollTimeout = setTimeout(fetchItems, 5000);
        }
    } catch (err) {
        console.error(err);
        showToast('Error loading roots: ' + err.message, 'error');
        if (itemsState.length === 0) {
            itemsTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger-color); padding: 32px;"><i class="fa-solid fa-circle-exclamation"></i> Error loading database records.</td></tr>`;
        }
    }
}

// 2. Render Table Rows
function renderTable(filterText = '') {
    const cleanFilter = filterText.toLowerCase().trim();
    
    const filteredItems = itemsState.filter(item => {
        if (!cleanFilter) return true;
        const idStr = String(item.productId);
        const nameStr = (item.name || '').toLowerCase();
        return idStr.includes(cleanFilter) || nameStr.includes(cleanFilter);
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
        
        const meshMatch = item.best_mesh_match || '-';
        const status = item.processing_status || 'Pending';
        const statusBadge = getStatusBadge(status);
        const isProcessing = status.toLowerCase() === 'processing';

        row.innerHTML = `
            <td><strong>${item.productId}</strong></td>
            <td>${escapeHtml(item.name)}</td>
            <td><code class="mesh-code">${escapeHtml(meshMatch)}</code></td>
            <td>${statusBadge}</td>
            <td class="actions-cell">
                ${isProcessing ? `
                    <button class="btn-action stop-action" title="Stop Running Pipeline" onclick="stopPipeline(${item.id})">
                        <i class="fa-solid fa-stop"></i>
                    </button>
                ` : `
                    <button class="btn-action run-action" title="Run PubMed & AI Pipeline" onclick="runPipeline(${item.id})">
                        <i class="fa-solid fa-play"></i>
                    </button>
                `}
                <button class="btn-action edit-action" title="Edit Root" onclick="openEditModal(${item.id})" ${isProcessing ? 'disabled' : ''}>
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn-action delete-action" title="Delete Root" onclick="openDeleteModal(${item.id})" ${isProcessing ? 'disabled' : ''}>
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        itemsTableBody.appendChild(row);
    });
}

function getStatusBadge(status) {
    const s = status.toLowerCase();
    let icon = 'fa-circle-question';
    if (s === 'pending') icon = 'fa-clock';
    else if (s === 'processing') icon = 'fa-spinner fa-spin';
    else if (s === 'completed') icon = 'fa-circle-check';
    else if (s === 'failed') icon = 'fa-circle-xmark';

    return `<span class="status-badge ${s}"><i class="fa-solid ${icon}"></i> ${status}</span>`;
}

async function runPipeline(dbId) {
    try {
        const res = await fetch(`/api/items/${dbId}/run`, {
            method: 'POST'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to start pipeline.');
        
        showToast('Pipeline started in background!', 'success');
        fetchItems();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function stopPipeline(dbId) {
    try {
        const res = await fetch(`/api/items/${dbId}/stop`, {
            method: 'POST'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to stop pipeline.');
        
        showToast('Pipeline stop requested!', 'warning');
        fetchItems();
    } catch (err) {
        showToast(err.message, 'error');
    }
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
                <td colspan="6" class="table-loading">
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
    const best_mesh_match = document.getElementById('add-mesh').value;

    try {
        const res = await fetch('/api/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, best_mesh_match })
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
function openEditModal(dbId) {
    const item = itemsState.find(i => i.id === dbId);
    if (!item) return;

    document.getElementById('edit-id').value = item.id;
    document.getElementById('edit-new-id').value = item.productId;
    document.getElementById('edit-name').value = item.name;
    
    // Fallback mesh match
    document.getElementById('edit-mesh').value = item.best_mesh_match || item.name || '';

    openModal(editModal);
}

editForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const oldDbId = document.getElementById('edit-id').value;
    const newProductId = document.getElementById('edit-new-id').value;
    const name = document.getElementById('edit-name').value;
    const best_mesh_match = document.getElementById('edit-mesh').value;

    try {
        const res = await fetch(`/api/items/${oldDbId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: newProductId, name, best_mesh_match })
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
function openDeleteModal(dbId) {
    const item = itemsState.find(i => i.id === dbId);
    if (!item) return;

    deleteTargetId = dbId;
    deleteItemNameLabel.textContent = item.name;
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
