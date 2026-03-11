/* ─────────────────────────────────────────────────────────────────
   dashboard_builder.js – Power BI-style interactive dashboard
───────────────────────────────────────────────────────────────── */

(function () {
'use strict';

/* ── Color palettes ─────────────────────────────────────────── */
const PALETTES = {
    default:     ['#4e79a7','#f28e2b','#e15759','#76b7b2','#59a14f','#edc948','#b07aa1','#ff9da7','#9c755f','#bab0ac'],
    blue:        ['#084594','#2171b5','#4292c6','#6baed6','#9ecae1','#c6dbef','#deebf7'],
    green:       ['#005a32','#238b45','#41ab5d','#74c476','#a1d99b','#c7e9c0','#e5f5e0'],
    red:         ['#67000d','#a50f15','#cb181d','#ef3b2c','#fb6a4a','#fc9272','#fcbba1'],
    purple:      ['#3f007d','#54278f','#6a51a3','#807dba','#9e9ac8','#bcbddc','#dadaeb'],
    monochrome:  ['#212529','#343a40','#495057','#6c757d','#adb5bd','#ced4da','#dee2e6'],
};

/* ── State ──────────────────────────────────────────────────── */
let grid;
let widgets     = {};   // id -> { config, chartInstance }
let activeFilter= null; // { col, val }
let previewChart= null;
let editingId   = null;

const MODAL_EL  = document.getElementById('dbbModal');
const bsModal   = new bootstrap.Modal(MODAL_EL);

/* ── Init Gridstack ─────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    grid = GridStack.init({
        column: 12,
        cellHeight: 70,
        animate: true,
        resizable: { handles: 'e,se,s,sw,w' },
        draggable:  { handle: '.dbb-drag-handle' },
    }, '#dbbGrid');

    grid.on('resizestop', (ev, el) => {
        const id = el.getAttribute('gs-id');
        if (id && widgets[id]) redrawChart(id);
    });

    // Toolbar buttons
    document.getElementById('dbbAddChart').addEventListener('click', openAddModal);
    document.getElementById('dbbSave').addEventListener('click', saveDashboard);
    document.getElementById('dbbLoad').addEventListener('click', loadDashboard);
    document.getElementById('dbbClear').addEventListener('click', clearAll);
    document.getElementById('dbbExportPDF').addEventListener('click', exportPDF);
    document.getElementById('dbbPreviewBtn').addEventListener('click', renderPreview);
    document.getElementById('dbbAddBtn').addEventListener('click', commitChart);
    document.getElementById('dbbClearFilter').addEventListener('click', clearFilter);

    // Show bubble size field only for bubble chart
    document.getElementById('dbbType').addEventListener('change', e => {
        const t = e.target.value;
        document.getElementById('sizeGroup').classList.toggle('d-none', t !== 'bubble');
        document.getElementById('xAxisGroup').classList.toggle('d-none', t === 'kpi');
        document.getElementById('yAxisGroup').classList.toggle('d-none', t === 'kpi');
    });

    // Auto-load saved dashboard
    const saved = localStorage.getItem('etlytix_dashboard');
    if (saved) {
        try {
            const items = JSON.parse(saved);
            items.forEach(item => addWidget(item.config, item.x, item.y, item.w, item.h));
        } catch (_) {}
    }
});

/* ── Modal helpers ──────────────────────────────────────────── */
function openAddModal() {
    editingId = null;
    document.getElementById('dbbModalTitle').textContent = 'Add Chart';
    document.getElementById('dbbAddBtn').textContent     = 'Add to Dashboard';
    document.getElementById('dbbAddBtn').innerHTML       = '<i class="fas fa-plus me-1"></i>Add to Dashboard';
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
    if (previewChart) { previewChart.destroy(); previewChart = null; }
    document.getElementById('dbbPreviewArea').innerHTML = '<canvas id="dbbPreviewCanvas" height="160"></canvas>';
}

function populateModalFromConfig(cfg) {
    document.getElementById('dbbTitle').value  = cfg.title  || '';
    document.getElementById('dbbType').value   = cfg.type   || 'bar';
    document.getElementById('dbbAgg').value    = cfg.agg    || 'sum';
    document.getElementById('dbbX').value      = cfg.x_col  || '';
    document.getElementById('dbbY').value      = cfg.y_col  || '';
    document.getElementById('dbbSize').value   = cfg.size_col|| '';
    document.getElementById('dbbColor').value  = cfg.palette|| 'default';
    document.getElementById('dbbTopN').value   = cfg.top_n  || 0;
    document.getElementById('sizeGroup').classList.toggle('d-none', cfg.type !== 'bubble');
    document.getElementById('xAxisGroup').classList.toggle('d-none', cfg.type === 'kpi');
    document.getElementById('yAxisGroup').classList.toggle('d-none', cfg.type === 'kpi');
}

/* ── Preview ────────────────────────────────────────────────── */
function renderPreview() {
    const cfg = readModalConfig();
    if (!cfg.x_col && cfg.type !== 'kpi') { alert('Please select at least an X-Axis column.'); return; }
    fetchChartData(cfg, null, data => {
        if (previewChart) { previewChart.destroy(); previewChart = null; }
        document.getElementById('dbbPreviewArea').innerHTML = '<canvas id="dbbPreviewCanvas" height="160"></canvas>';
        const ctx = document.getElementById('dbbPreviewCanvas').getContext('2d');
        previewChart = buildChartInstance(ctx, cfg, data);
    });
}

/* ── Commit / Edit ──────────────────────────────────────────── */
function commitChart() {
    const cfg = readModalConfig();
    if (!cfg.title) cfg.title = cfg.x_col || 'Chart';
    if (!cfg.x_col && cfg.type !== 'kpi') { alert('Please select an X-Axis column.'); return; }

    if (editingId) {
        // Update existing
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
    const id = 'w' + Date.now() + Math.random().toString(36).slice(2, 6);
    const html = buildWidgetHTML(id, cfg);
    const opts = { w: w||6, h: h||5, x: x, y: y, id, content: html, autoPosition: (x===undefined) };
    grid.addWidget(opts);

    updateEmptyHint();

    // Store and render
    widgets[id] = { config: cfg, chartInstance: null };
    setTimeout(() => redrawChart(id, activeFilter), 80);
}

function buildWidgetHTML(id, cfg) {
    return `
    <div class="grid-stack-item-content">
        <div class="dbb-widget-header">
            <span class="dbb-drag-handle"><i class="fas fa-grip-dots-vertical"></i></span>
            <span class="dbb-widget-title">${escHtml(cfg.title || 'Chart')}</span>
            <div class="dbb-widget-actions">
                <button title="Edit" onclick="dbbEditWidget('${id}')"><i class="fas fa-gear"></i></button>
                <button title="Duplicate" onclick="dbbDupeWidget('${id}')"><i class="fas fa-copy"></i></button>
                <button title="Remove" onclick="dbbRemoveWidget('${id}')"><i class="fas fa-xmark"></i></button>
            </div>
        </div>
        <div class="dbb-widget-body" id="body-${id}">
            <canvas id="canvas-${id}"></canvas>
        </div>
    </div>`;
}

/* ── Render / Redraw a chart ────────────────────────────────── */
function redrawChart(id, filter) {
    const w = widgets[id];
    if (!w) return;
    const cfg = w.config;

    if (cfg.type === 'kpi') {
        renderKPI(id, cfg);
        return;
    }

    fetchChartData(cfg, filter, data => {
        const body   = document.getElementById(`body-${id}`);
        const canvas = document.getElementById(`canvas-${id}`);
        if (!body || !canvas) return;

        // Destroy old chart
        if (w.chartInstance) { try { w.chartInstance.destroy(); } catch(_){} }

        // Resize canvas to container
        canvas.width  = body.offsetWidth  - 12;
        canvas.height = body.offsetHeight - 12;

        const ctx = canvas.getContext('2d');
        w.chartInstance = buildChartInstance(ctx, cfg, data, id);
    });
}

function renderKPI(id, cfg) {
    fetchChartData(cfg, activeFilter, data => {
        const body = document.getElementById(`body-${id}`);
        if (!body) return;
        const total = data.values ? data.values.reduce((a, b) => a + b, 0) : 0;
        const fmt   = total > 1e6 ? (total/1e6).toFixed(2)+'M'
                    : total > 1e3 ? (total/1e3).toFixed(1)+'K'
                    : total.toFixed(2);
        body.innerHTML = `
            <div class="dbb-kpi-card">
                <div class="dbb-kpi-value">${fmt}</div>
                <div class="dbb-kpi-label">${escHtml(cfg.y_col || 'Total')}</div>
                <div class="dbb-kpi-sub">${data.labels ? data.labels.length : 0} categories</div>
            </div>`;
    });
}

/* ── Fetch chart data from server ───────────────────────────── */
function fetchChartData(cfg, filter, cb) {
    const payload = {
        chart_type: cfg.type === 'area' ? 'line' : cfg.type === 'bar-h' ? 'bar' : cfg.type,
        x_axis:     cfg.x_col,
        y_axis:     cfg.y_col,
        size_col:   cfg.size_col,
        aggregation:cfg.agg,
        top_n:      cfg.top_n,
    };
    if (filter) {
        payload.filter_col = filter.col;
        payload.filter_val = filter.val;
    }

    fetch('/get-chart-data', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
    })
    .then(r => r.json())
    .then(cb)
    .catch(err => console.error('Chart data error:', err));
}

/* ── Build Chart.js instance ────────────────────────────────── */
function buildChartInstance(ctx, cfg, data, widgetId) {
    if (!data || !data.labels) return null;

    const palette  = PALETTES[cfg.palette] || PALETTES.default;
    const isMulti  = ['pie','doughnut','polarArea','radar'].includes(cfg.type);
    const colors   = data.labels.map((_, i) => palette[i % palette.length]);
    const alphaClr = colors.map(c => c + 'cc');

    const chartType = cfg.type === 'area' ? 'line'
                    : cfg.type === 'bar-h' ? 'bar'
                    : cfg.type === 'histogram' ? 'bar'
                    : cfg.type;

    // Dataset
    const datasets = [{
        label:           cfg.y_col || 'Value',
        data:            cfg.type === 'bubble' ? data.bubble_data || [] : data.values,
        backgroundColor: isMulti ? colors : alphaClr[0],
        borderColor:     isMulti ? colors.map(c => c) : palette[0],
        borderWidth:     1.5,
        fill:            cfg.type === 'area',
        tension:         cfg.type === 'area' || cfg.type === 'line' ? 0.35 : 0,
        pointRadius:     cfg.type === 'scatter' ? 5 : 3,
    }];

    const indexAxis = cfg.type === 'bar-h' ? 'y' : 'x';

    const chart = new Chart(ctx, {
        type: chartType,
        data: { labels: data.labels, datasets },
        options: {
            responsive:          true,
            maintainAspectRatio: false,
            indexAxis,
            animation:    { duration: 350 },
            plugins: {
                legend:  { display: isMulti, position: 'bottom', labels:{ boxWidth:12, padding:12 } },
                tooltip: { mode: 'index', intersect: false },
            },
            scales: chartType === 'radar' || isMulti ? {} : {
                x: { grid:{ color:'rgba(0,0,0,.04)' }, ticks:{ maxRotation:40, font:{size:10} } },
                y: { grid:{ color:'rgba(0,0,0,.06)' }, beginAtZero:true, ticks:{ font:{size:10} } },
            },
            onClick: widgetId ? (ev, els) => handleChartClick(ev, els, chart, cfg, widgetId) : undefined,
        },
    });
    return chart;
}

/* ── Cross-filter on click ──────────────────────────────────── */
function handleChartClick(ev, elements, chart, cfg, clickedWidgetId) {
    if (!elements.length) { clearFilter(); return; }
    const idx = elements[0].index;
    const lbl = chart.data.labels[idx];

    if (activeFilter && activeFilter.col === cfg.x_col && activeFilter.val === lbl) {
        clearFilter();
        return;
    }

    activeFilter = { col: cfg.x_col, val: lbl };
    document.getElementById('dbbFilterBadge').classList.remove('d-none');
    document.getElementById('dbbFilterVal').textContent = `${cfg.x_col} = "${lbl}"`;

    // Redraw all OTHER charts with filter
    Object.keys(widgets).forEach(id => {
        if (id !== clickedWidgetId) redrawChart(id, activeFilter);
    });
}

function clearFilter() {
    activeFilter = null;
    document.getElementById('dbbFilterBadge').classList.add('d-none');
    Object.keys(widgets).forEach(id => redrawChart(id, null));
}

/* ── Edit / Duplicate / Remove (global functions for onclick) ── */
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
};

/* ── Save / Load (localStorage) ────────────────────────────── */
function saveDashboard() {
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
    localStorage.setItem('etlytix_dashboard', JSON.stringify(items));
    showToast('Dashboard saved to browser storage!');
}

function loadDashboard() {
    const saved = localStorage.getItem('etlytix_dashboard');
    if (!saved) { showToast('No saved dashboard found.', 'warning'); return; }
    clearAll(true);
    try {
        const items = JSON.parse(saved);
        items.forEach(item => addWidget(item.config, item.x, item.y, item.w, item.h));
        showToast('Dashboard loaded!');
    } catch(e) {
        showToast('Failed to load dashboard.', 'danger');
    }
}

function clearAll(silent) {
    Object.keys(widgets).forEach(id => {
        const el = document.querySelector(`[gs-id="${id}"]`);
        if (el) grid.removeWidget(el);
        if (widgets[id] && widgets[id].chartInstance) {
            try { widgets[id].chartInstance.destroy(); } catch(_){}
        }
    });
    widgets = {};
    updateEmptyHint();
    if (!silent) showToast('Dashboard cleared.');
}

/* ── Export PDF ─────────────────────────────────────────────── */
function exportPDF() {
    if (typeof html2canvas === 'undefined' || typeof jspdf === 'undefined') {
        showToast('PDF libraries not loaded.', 'warning'); return;
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
    if (!hint) return;
    hint.classList.toggle('hidden', Object.keys(widgets).length > 0);
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, type) {
    const t = document.createElement('div');
    t.className = `alert alert-${type||'success'} position-fixed bottom-0 end-0 m-3 shadow`;
    t.style.zIndex = 9999;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

})();
