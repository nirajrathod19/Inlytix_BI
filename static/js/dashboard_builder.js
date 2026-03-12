/* ─────────────────────────────────────────────────────────────────
   dashboard_builder.js – Power BI-style interactive dashboard
   Fully fixed: bootstrap modal timing, scatter/bubble data, KPI,
   canvas sizing, server-side save/load.
───────────────────────────────────────────────────────────────── */

(function () {
'use strict';

/* ── Color palettes ─────────────────────────────────────────── */
const PALETTES = {
    default:    ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac'],
    blue:       ['#084594','#2171b5','#4292c6','#6baed6','#9ecae1','#c6dbef','#deebf7'],
    green:      ['#005a32','#238b45','#41ab5d','#74c476','#a1d99b','#c7e9c0','#e5f5e0'],
    red:        ['#67000d','#a50f15','#cb181d','#ef3b2c','#fb6a4a','#fc9272','#fcbba1'],
    purple:     ['#3f007d','#54278f','#6a51a3','#807dba','#9e9ac8','#bcbddc','#dadaeb'],
    monochrome: ['#212529','#343a40','#495057','#6c757d','#adb5bd','#ced4da','#dee2e6'],
};

/* ── State ──────────────────────────────────────────────────── */
let grid;
let bsModal;              // initialized inside DOMContentLoaded
let widgets     = {};     // id -> { config, chartInstance }
let activeFilter= null;   // { col, val }
let previewChart= null;
let editingId   = null;
let currentDashId = null; // server-side dashboard id

/* ── Init ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {

    /* Bootstrap must be loaded by now (layout.html footer) */
    const modalEl = document.getElementById('dbbModal');
    bsModal = new bootstrap.Modal(modalEl, { backdrop: 'static' });

    /* Gridstack */
    grid = GridStack.init({
        column:     12,
        cellHeight: 80,
        animate:    true,
        resizable:  { handles: 'e,se,s,sw,w' },
        draggable:  { handle: '.dbb-drag-handle' },
    }, '#dbbGrid');

    grid.on('resizestop', (ev, el) => {
        const id = el.getAttribute('gs-id');
        if (id && widgets[id]) redrawChart(id);
    });

    /* Toolbar */
    document.getElementById('dbbAddChart')  .addEventListener('click', openAddModal);
    document.getElementById('dbbSave')      .addEventListener('click', saveToServer);
    document.getElementById('dbbSaveAs')    .addEventListener('click', saveAsNew);
    document.getElementById('dbbLoad')      .addEventListener('click', openLoadPanel);
    document.getElementById('dbbClear')     .addEventListener('click', () => clearAll(false));
    document.getElementById('dbbExportPDF') .addEventListener('click', exportPDF);
    document.getElementById('dbbPreviewBtn').addEventListener('click', renderPreview);
    document.getElementById('dbbAddBtn')    .addEventListener('click', commitChart);
    document.getElementById('dbbClearFilter').addEventListener('click', clearFilter);

    /* Show/hide fields based on chart type */
    document.getElementById('dbbType').addEventListener('change', e => {
        const t = e.target.value;
        document.getElementById('sizeGroup') .classList.toggle('d-none', t !== 'bubble');
        document.getElementById('xAxisGroup').classList.toggle('d-none', t === 'kpi');
        document.getElementById('yAxisGroup').classList.toggle('d-none', t === 'histogram');
        document.getElementById('aggGroup')  .classList.toggle('d-none', t === 'scatter' || t === 'bubble' || t === 'histogram' || t === 'kpi');
    });

    /* Auto-load last local session */
    const saved = localStorage.getItem('etlytix_dashboard');
    if (saved) {
        try {
            const items = JSON.parse(saved);
            items.forEach(item => addWidget(item.config, item.x, item.y, item.w, item.h));
        } catch (_) {}
    }

    /* Load dropdown listing */
    refreshLoadList();
});

/* ── Modal helpers ──────────────────────────────────────────── */
function openAddModal() {
    editingId = null;
    document.getElementById('dbbModalTitle').textContent = 'Add Chart';
    document.getElementById('dbbAddBtn').innerHTML = '<i class="fas fa-plus me-1"></i>Add to Dashboard';
    clearModalFields();
    bsModal.show();
}

function clearModalFields() {
    document.getElementById('editingWidgetId').value = '';
    document.getElementById('dbbTitle').value  = '';
    document.getElementById('dbbType').value   = 'bar';
    document.getElementById('dbbAgg').value    = 'sum';
    document.getElementById('dbbX').value      = '';
    document.getElementById('dbbY').value      = '';
    document.getElementById('dbbSize').value   = '';
    document.getElementById('dbbColor').value  = 'default';
    document.getElementById('dbbTopN').value   = '0';
    ['sizeGroup','aggGroup'].forEach(id => document.getElementById(id).classList.add('d-none'));
    ['xAxisGroup','yAxisGroup'].forEach(id => document.getElementById(id).classList.remove('d-none'));
    if (previewChart) { try { previewChart.destroy(); } catch(_){} previewChart = null; }
    document.getElementById('dbbPreviewArea').innerHTML = '<canvas id="dbbPreviewCanvas" style="max-height:180px"></canvas>';
}

function populateModalFromConfig(cfg) {
    document.getElementById('dbbTitle').value  = cfg.title   || '';
    document.getElementById('dbbType').value   = cfg.type    || 'bar';
    document.getElementById('dbbAgg').value    = cfg.agg     || 'sum';
    document.getElementById('dbbX').value      = cfg.x_col   || '';
    document.getElementById('dbbY').value      = cfg.y_col   || '';
    document.getElementById('dbbSize').value   = cfg.size_col|| '';
    document.getElementById('dbbColor').value  = cfg.palette || 'default';
    document.getElementById('dbbTopN').value   = cfg.top_n   || 0;
    const t = cfg.type || 'bar';
    document.getElementById('sizeGroup') .classList.toggle('d-none', t !== 'bubble');
    document.getElementById('xAxisGroup').classList.toggle('d-none', t === 'kpi');
    document.getElementById('yAxisGroup').classList.toggle('d-none', t === 'histogram');
    document.getElementById('aggGroup')  .classList.toggle('d-none', t === 'scatter' || t === 'bubble' || t === 'histogram' || t === 'kpi');
}

/* ── Preview ────────────────────────────────────────────────── */
function renderPreview() {
    const cfg = readModalConfig();
    if (!cfg.x_col && cfg.type !== 'kpi') {
        showToast('Please select an X-Axis column first.', 'warning'); return;
    }
    document.getElementById('dbbPreviewArea').innerHTML =
        '<div class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>Loading preview…</div>';
    fetchChartData(cfg, null, data => {
        document.getElementById('dbbPreviewArea').innerHTML =
            '<canvas id="dbbPreviewCanvas" style="max-height:180px"></canvas>';
        const canvas = document.getElementById('dbbPreviewCanvas');
        const ctx    = canvas.getContext('2d');
        if (previewChart) { try { previewChart.destroy(); } catch(_){} previewChart = null; }
        if (cfg.type === 'kpi' && data.kpi) {
            renderKPIInEl(document.getElementById('dbbPreviewArea'), data.kpi, cfg);
        } else {
            previewChart = buildChartInstance(ctx, cfg, data, null);
        }
    }, err => {
        document.getElementById('dbbPreviewArea').innerHTML =
            `<div class="alert alert-danger py-2 my-2">${escHtml(err)}</div>`;
    });
}

/* ── Commit / Edit ──────────────────────────────────────────── */
function commitChart() {
    const cfg = readModalConfig();
    if (!cfg.title) cfg.title = cfg.x_col || cfg.y_col || 'Chart';
    if (!cfg.x_col && cfg.type !== 'kpi') {
        showToast('Please select an X-Axis column.', 'warning'); return;
    }
    if (editingId) {
        if (widgets[editingId]) {
            widgets[editingId].config = cfg;
            const titleEl = document.querySelector(`[gs-id="${editingId}"] .dbb-widget-title`);
            if (titleEl) titleEl.textContent = cfg.title;
            redrawChart(editingId, activeFilter);
        }
    } else {
        addWidget(cfg);
    }
    bsModal.hide();
    updateEmptyHint();
    autoSaveLocal();
}

function readModalConfig() {
    return {
        title:    document.getElementById('dbbTitle').value.trim(),
        type:     document.getElementById('dbbType').value,
        agg:      document.getElementById('dbbAgg').value,
        x_col:    document.getElementById('dbbX').value,
        y_col:    document.getElementById('dbbY').value,
        size_col: document.getElementById('dbbSize').value,
        palette:  document.getElementById('dbbColor').value,
        top_n:    parseInt(document.getElementById('dbbTopN').value) || 0,
    };
}

/* ── Add widget to grid ─────────────────────────────────────── */
function addWidget(cfg, x, y, w, h) {
    const id  = 'w' + Date.now() + Math.random().toString(36).slice(2, 6);
    const wW  = w || (cfg.type === 'kpi' ? 3 : 6);
    const wH  = h || (cfg.type === 'kpi' ? 3 : 5);
    const html = buildWidgetHTML(id, cfg);
    grid.addWidget({ w: wW, h: wH, x, y, id, content: html, autoPosition: (x === undefined) });
    widgets[id] = { config: cfg, chartInstance: null };
    updateEmptyHint();
    setTimeout(() => redrawChart(id, activeFilter), 120);
}

function buildWidgetHTML(id, cfg) {
    return `
    <div class="grid-stack-item-content">
        <div class="dbb-widget-header">
            <span class="dbb-drag-handle"><i class="fas fa-grip-dots-vertical"></i></span>
            <span class="dbb-widget-title">${escHtml(cfg.title || 'Chart')}</span>
            <div class="dbb-widget-actions">
                <button title="Edit"      onclick="dbbEditWidget('${id}')"><i class="fas fa-gear"></i></button>
                <button title="Duplicate" onclick="dbbDupeWidget('${id}')"><i class="fas fa-copy"></i></button>
                <button title="Remove"    onclick="dbbRemoveWidget('${id}')"><i class="fas fa-xmark"></i></button>
            </div>
        </div>
        <div class="dbb-widget-body" id="body-${id}">
            <div class="dbb-loading"><div class="spinner-border spinner-border-sm text-primary"></div></div>
        </div>
    </div>`;
}

/* ── Render / Redraw ────────────────────────────────────────── */
function redrawChart(id, filter) {
    const w = widgets[id];
    if (!w) return;
    const cfg  = w.config;
    const body = document.getElementById(`body-${id}`);
    if (!body) return;

    body.innerHTML = '<div class="dbb-loading"><div class="spinner-border spinner-border-sm text-primary"></div></div>';

    if (cfg.type === 'kpi') {
        fetchChartData(cfg, filter || activeFilter, data => {
            renderKPIInEl(body, data.kpi || {}, cfg);
        });
        return;
    }

    fetchChartData(cfg, filter || activeFilter, data => {
        if (!data || data.error) {
            body.innerHTML = `<div class="dbb-error"><i class="fas fa-exclamation-circle me-1"></i>${escHtml((data && data.error) || 'No data')}</div>`;
            return;
        }

        if (cfg.type === 'table') {
            body.style.overflow = 'auto';
            body.innerHTML = `<div class="table-responsive" style="max-height:100%">${data.chart_data || ''}</div>`;
            return;
        }

        body.innerHTML = '<canvas id="canvas-' + id + '" style="width:100%;height:100%"></canvas>';
        if (w.chartInstance) { try { w.chartInstance.destroy(); } catch(_){} w.chartInstance = null; }
        const ctx = document.getElementById('canvas-' + id).getContext('2d');
        w.chartInstance = buildChartInstance(ctx, cfg, data, id);
    });
}

/* ── KPI renderer ───────────────────────────────────────────── */
function renderKPIInEl(el, kpi, cfg) {
    const total = kpi.total != null ? kpi.total : 0;
    const avg   = kpi.avg   != null ? kpi.avg   : 0;
    const max   = kpi.max   != null ? kpi.max   : 0;
    const min   = kpi.min   != null ? kpi.min   : 0;
    const col   = kpi.col   || cfg.y_col || cfg.x_col || '';
    const fmt   = v => v > 1e9  ? (v/1e9).toFixed(2)+'B'
                     : v > 1e6  ? (v/1e6).toFixed(2)+'M'
                     : v > 1e3  ? (v/1e3).toFixed(1)+'K'
                     : Number.isFinite(v) ? v.toFixed(2) : '—';
    el.style.overflow = '';
    el.innerHTML = `
        <div class="dbb-kpi-card">
            <div class="dbb-kpi-value">${fmt(total)}</div>
            <div class="dbb-kpi-label">${escHtml(col)} — Total</div>
            <div class="dbb-kpi-stats">
                <span><i class="fas fa-chart-line text-success me-1"></i>Avg <strong>${fmt(avg)}</strong></span>
                <span><i class="fas fa-arrow-up text-danger me-1"></i>Max <strong>${fmt(max)}</strong></span>
                <span><i class="fas fa-arrow-down text-primary me-1"></i>Min <strong>${fmt(min)}</strong></span>
            </div>
        </div>`;
}

/* ── Fetch chart data ───────────────────────────────────────── */
function fetchChartData(cfg, filter, onSuccess, onError) {
    const backendType =
          cfg.type === 'area'    ? 'line'
        : cfg.type === 'bar-h'  ? 'bar'
        : cfg.type;

    const payload = {
        chart_type:  backendType,
        x_axis:      cfg.x_col,
        y_axis:      cfg.y_col,
        size_col:    cfg.size_col,
        aggregation: cfg.agg,
        top_n:       cfg.top_n,
    };
    if (filter && filter.col) {
        payload.filter_col = filter.col;
        payload.filter_val = filter.val;
    }

    fetch('/get-chart-data', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
    })
    .then(r => r.json())
    .then(data => {
        if (data.error) { if (onError) onError(data.error); else console.warn('Chart data error:', data.error); }
        else            { onSuccess(data); }
    })
    .catch(err => {
        console.error('Fetch error:', err);
        if (onError) onError('Network error');
    });
}

/* ── Build Chart.js instance ────────────────────────────────── */
function buildChartInstance(ctx, cfg, data, widgetId) {
    if (!data || !data.labels || !data.labels.length) {
        const body = widgetId ? document.getElementById('body-' + widgetId) : null;
        if (body) body.innerHTML = '<div class="dbb-error"><i class="fas fa-info-circle me-1"></i>No data for this selection.</div>';
        return null;
    }

    const palette   = PALETTES[cfg.palette] || PALETTES.default;
    const isCircle  = ['pie','doughnut','polarArea'].includes(cfg.type);
    const isRadar   = cfg.type === 'radar';
    const isMulti   = isCircle || isRadar;
    const colors    = data.labels.map((_, i) => palette[i % palette.length]);

    const chartType =
          cfg.type === 'area'      ? 'line'
        : cfg.type === 'bar-h'    ? 'bar'
        : cfg.type === 'histogram'? 'bar'
        : cfg.type === 'scatter'  ? 'scatter'
        : cfg.type === 'bubble'   ? 'bubble'
        : cfg.type;

    /* Correct dataset data per type */
    let chartData;
    if (cfg.type === 'scatter')  chartData = data.chart_data || [];
    else if (cfg.type === 'bubble') chartData = data.bubble_data || [];
    else chartData = data.values || [];

    const dataset = {
        label:           cfg.y_col || cfg.x_col || 'Value',
        data:            chartData,
        backgroundColor: isMulti ? colors : colors[0] + 'cc',
        borderColor:     isMulti ? colors : palette[0],
        borderWidth:     1.5,
        fill:            cfg.type === 'area',
        tension:         (cfg.type === 'area' || cfg.type === 'line') ? 0.38 : 0,
        pointRadius:     cfg.type === 'scatter' ? 4 : 3,
    };

    const indexAxis = cfg.type === 'bar-h' ? 'y' : 'x';

    const scales = (isCircle || isRadar) ? {} : {
        x: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { maxRotation: 40, font: { size: 10 } } },
        y: { grid: { color: 'rgba(0,0,0,.06)' }, beginAtZero: true, ticks: { font: { size: 10 } } },
    };

    const chart = new Chart(ctx, {
        type: chartType,
        data: { labels: data.labels, datasets: [dataset] },
        options: {
            responsive:          true,
            maintainAspectRatio: false,
            indexAxis,
            animation:  { duration: 300 },
            plugins: {
                legend:  { display: isMulti, position: 'bottom', labels: { boxWidth: 12, padding: 10 } },
                tooltip: { mode: 'nearest', intersect: false },
            },
            scales,
            onClick: widgetId
                ? (ev, els) => handleChartClick(ev, els, chart, cfg, widgetId)
                : undefined,
        },
    });
    return chart;
}

/* ── Cross-filter ───────────────────────────────────────────── */
function handleChartClick(ev, elements, chart, cfg, clickedId) {
    if (!elements.length) { clearFilter(); return; }
    const idx = elements[0].index;
    const lbl = chart.data.labels[idx];

    if (activeFilter && activeFilter.col === cfg.x_col && activeFilter.val === lbl) {
        clearFilter(); return;
    }

    activeFilter = { col: cfg.x_col, val: lbl };
    document.getElementById('dbbFilterBadge').classList.remove('d-none');
    document.getElementById('dbbFilterVal').textContent = `${cfg.x_col} = "${lbl}"`;
    Object.keys(widgets).forEach(id => { if (id !== clickedId) redrawChart(id, activeFilter); });
}

function clearFilter() {
    activeFilter = null;
    document.getElementById('dbbFilterBadge').classList.add('d-none');
    Object.keys(widgets).forEach(id => redrawChart(id, null));
}

/* ── Edit / Dupe / Remove (exposed globally for onclick) ──── */
window.dbbEditWidget = function(id) {
    const w = widgets[id];
    if (!w) return;
    editingId = id;
    document.getElementById('dbbModalTitle').textContent = 'Edit Chart';
    document.getElementById('dbbAddBtn').innerHTML = '<i class="fas fa-check me-1"></i>Update Chart';
    document.getElementById('editingWidgetId').value = id;
    clearModalFields();
    populateModalFromConfig(w.config);
    bsModal.show();
};

window.dbbDupeWidget = function(id) {
    const w = widgets[id];
    if (!w) return;
    addWidget({ ...w.config, title: w.config.title + ' (copy)' });
};

window.dbbRemoveWidget = function(id) {
    const el = document.querySelector(`[gs-id="${id}"]`);
    if (el) grid.removeWidget(el);
    if (widgets[id] && widgets[id].chartInstance) {
        try { widgets[id].chartInstance.destroy(); } catch(_){}
    }
    delete widgets[id];
    updateEmptyHint();
    autoSaveLocal();
};

/* ── Server-side Save / Load ────────────────────────────────── */
function collectItems() {
    const items = [];
    document.querySelectorAll('.grid-stack-item').forEach(el => {
        const id = el.getAttribute('gs-id');
        if (!id || !widgets[id]) return;
        items.push({
            config: widgets[id].config,
            x: parseInt(el.getAttribute('gs-x')) || 0,
            y: parseInt(el.getAttribute('gs-y')) || 0,
            w: parseInt(el.getAttribute('gs-w')) || 6,
            h: parseInt(el.getAttribute('gs-h')) || 5,
        });
    });
    return items;
}

function autoSaveLocal() {
    try { localStorage.setItem('etlytix_dashboard', JSON.stringify(collectItems())); } catch(_){}
}

function saveToServer() {
    const items = collectItems();
    if (!items.length) { showToast('Add at least one chart before saving.', 'warning'); return; }
    const name = currentDashId
        ? (document.getElementById('dbbCurrentName').textContent || 'My Dashboard')
        : prompt('Dashboard name:', 'My Dashboard');
    if (!name) return;
    fetch('/api/dashboard/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentDashId, name: name.trim(), config: items }),
    })
    .then(r => r.json())
    .then(d => {
        if (d.success) {
            currentDashId = d.id;
            document.getElementById('dbbCurrentName').textContent = d.name;
            showToast(`Saved: ${d.name}`);
            autoSaveLocal();
            refreshLoadList();
        } else {
            showToast(d.error || 'Save failed.', 'danger');
        }
    })
    .catch(() => showToast('Save failed – network error.', 'danger'));
}

function saveAsNew() {
    const name = prompt('New dashboard name:', 'My Dashboard');
    if (!name) return;
    const items = collectItems();
    fetch('/api/dashboard/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), config: items }),
    })
    .then(r => r.json())
    .then(d => {
        if (d.success) {
            currentDashId = d.id;
            document.getElementById('dbbCurrentName').textContent = d.name;
            showToast(`Saved as new: ${d.name}`);
            autoSaveLocal();
            refreshLoadList();
        } else { showToast(d.error || 'Save failed.', 'danger'); }
    })
    .catch(() => showToast('Save failed.', 'danger'));
}

function refreshLoadList() {
    fetch('/api/dashboard/list')
        .then(r => r.json())
        .then(list => {
            const ul = document.getElementById('dbbSavedList');
            if (!ul) return;
            if (!list.length) {
                ul.innerHTML = '<li class="list-group-item text-muted small py-2">No saved dashboards yet</li>';
                return;
            }
            ul.innerHTML = list.map(d => `
                <li class="list-group-item d-flex justify-content-between align-items-center py-2">
                    <div>
                        <div class="fw-semibold small">${escHtml(d.name)}</div>
                        <div class="text-muted" style="font-size:.75rem">${escHtml(d.modified)}</div>
                    </div>
                    <div class="d-flex gap-1">
                        <button class="btn btn-primary btn-sm" onclick="loadDashboard(${d.id})">
                            <i class="fas fa-folder-open"></i>
                        </button>
                        <button class="btn btn-outline-danger btn-sm" onclick="deleteDashboard(${d.id},this)">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </li>`).join('');
        })
        .catch(() => {});
}

function openLoadPanel() {
    refreshLoadList();
    const panel = document.getElementById('dbbLoadPanel');
    panel.classList.toggle('d-none');
}

window.loadDashboard = function(id) {
    fetch(`/api/dashboard/${id}`)
        .then(r => r.json())
        .then(d => {
            clearAll(true);
            currentDashId = d.id;
            document.getElementById('dbbCurrentName').textContent = d.name;
            d.config.forEach(item => addWidget(item.config, item.x, item.y, item.w, item.h));
            document.getElementById('dbbLoadPanel').classList.add('d-none');
            showToast(`Loaded: ${d.name}`);
        })
        .catch(() => showToast('Load failed.', 'danger'));
};

window.deleteDashboard = function(id, btn) {
    if (!confirm('Delete this dashboard?')) return;
    fetch(`/api/dashboard/${id}/delete`, { method: 'DELETE' })
        .then(r => r.json())
        .then(d => {
            if (d.success) {
                if (currentDashId === id) { currentDashId = null; document.getElementById('dbbCurrentName').textContent = 'Unsaved'; }
                refreshLoadList();
                showToast('Dashboard deleted.');
            }
        })
        .catch(() => showToast('Delete failed.', 'danger'));
};

/* ── Clear all ──────────────────────────────────────────────── */
function clearAll(silent) {
    Object.keys(widgets).forEach(id => {
        const el = document.querySelector(`[gs-id="${id}"]`);
        if (el) grid.removeWidget(el);
        if (widgets[id] && widgets[id].chartInstance) {
            try { widgets[id].chartInstance.destroy(); } catch(_){}
        }
    });
    widgets = {};
    currentDashId = null;
    document.getElementById('dbbCurrentName').textContent = 'Unsaved';
    updateEmptyHint();
    if (!silent) showToast('Dashboard cleared.');
}

/* ── Export PDF ─────────────────────────────────────────────── */
function exportPDF() {
    if (typeof html2canvas === 'undefined' || typeof jspdf === 'undefined') {
        showToast('PDF libraries not loaded. Add html2canvas & jspdf to the page.', 'warning'); return;
    }
    const el = document.getElementById('dbbGrid');
    html2canvas(el, { scale: 1.5, backgroundColor: '#f4f6fb' }).then(canvas => {
        const { jsPDF } = jspdf;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width, canvas.height] });
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
        pdf.save('etlytix-dashboard.pdf');
    });
}

/* ── Helpers ─────────────────────────────────────────────────── */
function updateEmptyHint() {
    const hint = document.getElementById('dbbEmptyHint');
    if (hint) hint.classList.toggle('hidden', Object.keys(widgets).length > 0);
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, type) {
    const t = document.createElement('div');
    t.className = `alert alert-${type || 'success'} position-fixed bottom-0 end-0 m-3 shadow`;
    t.style.cssText = 'z-index:9999;min-width:220px;animation:fadeIn .2s';
    t.innerHTML = `<i class="fas fa-${type === 'danger' ? 'circle-xmark' : type === 'warning' ? 'triangle-exclamation' : 'circle-check'} me-2"></i>${escHtml(msg)}`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
}

})();
