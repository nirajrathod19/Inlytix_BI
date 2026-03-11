/* ──────────────────────────────────────────────────────────
   chart_builder.js  –  Primary Chart Builder Logic
   ────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', function () {

    // ── Element references ─────────────────────────────────
    const createChartBtn   = document.getElementById('createChartBtn');
    const saveProjectBtn   = document.getElementById('saveProjectBtn');
    const exportPdfBtn     = document.getElementById('exportPdfBtn');
    const pdfSpinner       = document.getElementById('pdfSpinner');
    const getAiInsightsBtn = document.getElementById('getAiInsightsBtn');
    const forecastBtn      = document.getElementById('forecastBtn');
    const addToStoryBtn    = document.getElementById('addToStoryBtn');
    const clearFilterBtn   = document.getElementById('clearFilterBtn');

    if (!createChartBtn) return;  // Not on chart builder page

    const CHART_COLORS = [
        'rgba(79,70,229,.8)',  'rgba(54,162,235,.8)',
        'rgba(255,206,86,.8)', 'rgba(75,192,192,.8)',
        'rgba(153,102,255,.8)','rgba(255,159,64,.8)',
        'rgba(255,99,132,.8)', 'rgba(107,33,168,.8)',
    ];

    let myChart  = null;
    let myChart2 = null;
    let lastChartConfig = {};

    // ── Helpers ────────────────────────────────────────────
    function populateInsights(insights) {
        const table = document.getElementById('insightsTable');
        if (!table) return;
        table.innerHTML = '';
        const tbody = document.createElement('tbody');
        for (const [k, v] of Object.entries(insights)) {
            const row = tbody.insertRow();
            row.insertCell().innerHTML = `<strong>${k}</strong>`;
            row.insertCell().textContent = v;
        }
        table.appendChild(tbody);
    }

    // ── Executive Narrative ────────────────────────────────
    function fetchExecutiveNarrative(config) {
        const card = document.getElementById('execNarrativeCard');
        const text = document.getElementById('execNarrativeText');
        if (!card || !text) return;

        text.innerHTML = '<span class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i> Generating executive summary…</span>';
        card.style.display = 'block';

        fetch('/executive-narrative', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config),
        })
        .then(r => r.json())
        .then(data => {
            text.innerHTML = data.narrative || '<span class="text-danger">Could not generate narrative.</span>';
        })
        .catch(() => {
            text.innerHTML = '<span class="text-danger">Failed to load narrative.</span>';
        });
    }

    // ── Primary Chart Generation ───────────────────────────
    function generatePrimaryChart(isExport = false) {
        return new Promise((resolve, reject) => {
            const chartType   = document.getElementById('chartType').value;
            const xAxis       = document.getElementById('xAxis').value;
            const yAxis       = document.getElementById('yAxis').value;
            const aggregation = (document.getElementById('aggregation') || {}).value || 'sum';
            const animation   = isExport ? { duration: 0 } : {};

            lastChartConfig = { chart_type: chartType, x_axis: xAxis, y_axis: yAxis, aggregation };

            fetch('/get-chart-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(lastChartConfig),
            })
            .then(r => r.json())
            .then(data => {
                if (data.error) { alert('Error: ' + data.error); return reject(data.error); }

                populateInsights(data.insights);

                // Update chart title
                const titleEl = document.getElementById('chartTitle');
                if (titleEl) titleEl.textContent = `${yAxis} by ${xAxis}`;

                // Enable AI insights button
                if (getAiInsightsBtn) getAiInsightsBtn.disabled = false;

                // ── Handle special types ──────────────────
                if (chartType === 'table') {
                    document.getElementById('table-container').style.display = 'block';
                    document.getElementById('table-display-area').innerHTML = data.chart_data;
                    document.getElementById('chart-container').style.display = 'none';
                    resolve();
                    return;
                } else {
                    document.getElementById('table-container').style.display = 'none';
                    document.getElementById('chart-container').style.display = 'block';
                }

                // ── Canvas chart ──────────────────────────
                const ctx = document.getElementById('myChart').getContext('2d');
                if (myChart)  { myChart.destroy();  myChart  = null; }
                if (myChart2) { myChart2.destroy(); myChart2 = null; }
                const t2Title = document.getElementById('chart2-title');
                if (t2Title) t2Title.textContent = 'Click any bar, slice, or data point to drill down here.';
                if (clearFilterBtn) clearFilterBtn.classList.add('d-none');

                let chartData, chartOptions;
                const labels = data.labels || (data.chart_data ? data.chart_data.map(d => d.key || d.name) : []);
                const values = data.values || (data.chart_data ? data.chart_data.map(d => d.value) : []);

                // Resolve the actual Chart.js type
                const circularTypes = ['pie','doughnut','polarArea','radar'];
                const isCircular    = circularTypes.includes(chartType);
                const isArea        = chartType === 'area';
                const isBarH        = chartType === 'bar-h';
                const isBubble      = chartType === 'bubble';
                const isScatter     = chartType === 'scatter';
                const cjsType       = isArea ? 'line' : isBarH ? 'bar' : isBubble ? 'bubble' : isScatter ? 'scatter' : chartType;
                const indexAxis     = isBarH ? 'y' : 'x';

                const multiColor    = (chartType === 'bar' || isBarH || isCircular || chartType === 'histogram')
                    ? labels.map((_, i) => CHART_COLORS[i % CHART_COLORS.length])
                    : 'rgba(79,70,229,.8)';

                if (isScatter) {
                    chartData = {
                        datasets: [{
                            label: `${yAxis} vs ${xAxis}`,
                            data: data.chart_data,
                            backgroundColor: 'rgba(79,70,229,.7)',
                            pointRadius: 5,
                        }]
                    };
                } else if (isBubble) {
                    chartData = {
                        datasets: [{
                            label: `${xAxis} / ${yAxis}`,
                            data: data.bubble_data || data.chart_data || [],
                            backgroundColor: 'rgba(79,70,229,.6)',
                        }]
                    };
                } else {
                    chartData = {
                        labels,
                        datasets: [{
                            label: yAxis || xAxis,
                            data: values,
                            backgroundColor: multiColor,
                            borderColor: isCircular ? 'rgba(255,255,255,.6)' : 'rgba(79,70,229,1)',
                            borderWidth: (chartType === 'line' || isArea) ? 2.5 : 1,
                            fill: isArea,
                            tension: (chartType === 'line' || isArea) ? 0.35 : 0,
                            pointRadius: (chartType === 'line' || isArea) ? 3 : undefined,
                        }]
                    };
                }

                chartOptions = {
                    animation,
                    indexAxis,
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: isCircular, position: 'bottom' },
                        tooltip: { mode: 'index', intersect: false }
                    },
                    onClick: (_evt, elements) => {
                        if (elements.length > 0) {
                            const idx   = elements[0].index;
                            const label = myChart.data.labels ? myChart.data.labels[idx] : '';
                            generateFilteredChart(xAxis, label);
                            if (clearFilterBtn) clearFilterBtn.classList.remove('d-none');
                        }
                    },
                    scales: (isCircular || chartType === 'radar') ? {} : {
                        x: { grid: { color: 'rgba(0,0,0,.04)' }, title: { display: !!xAxis, text: xAxis } },
                        y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,.06)' }, title: { display: !!yAxis, text: yAxis } },
                    }
                };

                myChart = new Chart(ctx, { type: cjsType, data: chartData, options: chartOptions });

                // Executive narrative (skip for table/treemap)
                if (!['table', 'treemap', 'scatter'].includes(chartType)) {
                    fetchExecutiveNarrative({ x_axis: xAxis, y_axis: yAxis, chart_type: chartType });
                }

                setTimeout(resolve, 500);
            })
            .catch(reject);
        });
    }

    // ── Cross-filter drill-down ────────────────────────────
    function generateFilteredChart(filterColumn, filterValue) {
        const secondaryXAxis  = document.getElementById('secondaryXAxis').value;
        const secondaryChartType = document.getElementById('secondaryChartType').value;
        const yAxis = document.getElementById('yAxis').value;

        const t2Title = document.getElementById('chart2-title');
        if (t2Title) t2Title.textContent = `Drill-Down: ${filterColumn} = "${filterValue}"`;

        fetch('/get-chart-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                x_axis: secondaryXAxis,
                y_axis: yAxis,
                filter_col: filterColumn,
                filter_val: filterValue,
                chart_type: secondaryChartType,
            }),
        })
        .then(r => r.json())
        .then(data => {
            if (data.error) { alert('Drill-Down Error: ' + data.error); return; }
            const ctx2 = document.getElementById('myChart2').getContext('2d');
            if (myChart2) myChart2.destroy();

            const lbls  = data.labels || (data.chart_data ? data.chart_data.map(d => d.key) : []);
            const vals  = data.values || (data.chart_data ? data.chart_data.map(d => d.value) : []);
            const bgColors = lbls.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
            myChart2 = new Chart(ctx2, {
                type: secondaryChartType,
                data: {
                    labels: lbls,
                    datasets: [{
                        label: `${yAxis} for "${filterValue}"`,
                        data: vals,
                        backgroundColor: bgColors,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: secondaryChartType !== 'pie' } }
                }
            });
        })
        .catch(err => console.error('Drill-down error:', err));
    }

    // ── Forecast ───────────────────────────────────────────
    function applyForecast() {
        if (!myChart || myChart.config.type !== 'line') {
            alert('Forecasting only works on the primary Line Chart.');
            return;
        }
        const periods = document.getElementById('forecastPeriods').value;
        const xAxis   = document.getElementById('xAxis').value;
        const yAxis   = document.getElementById('yAxis').value;

        fetch('/get-forecast-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ x_axis: xAxis, y_axis: yAxis, periods }),
        })
        .then(r => r.json())
        .then(data => {
            if (data.error) { alert('Forecast error: ' + data.error); return; }
            if (myChart.data.datasets.length > 1) myChart.data.datasets.pop();
            myChart.data.datasets.push({
                label: 'Forecast',
                data: data.values,
                borderColor: 'red',
                borderDash: [5, 5],
                fill: false,
                pointRadius: 4,
                backgroundColor: 'red',
            });
            myChart.data.labels.push(...data.labels);
            myChart.update();
        });
    }

    // ── Save Project ───────────────────────────────────────
    function saveProject() {
        const name = prompt('Enter a name for your project:');
        if (!name) return;
        fetch('/project/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, action: 'check' }),
        })
        .then(r => r.json())
        .then(data => {
            if (data.exists) {
                showReplaceModal(name);
            } else {
                performSave(name, 'save_new');
            }
        });
    }

    function showReplaceModal(name) {
        const modal = document.getElementById('replace-modal');
        document.getElementById('modal-text').textContent =
            `A project named "${name}" already exists. Replace it?`;
        modal.style.display = 'flex';
        document.getElementById('modal-yes').onclick = () => { modal.style.display = 'none'; performSave(name, 'overwrite'); };
        document.getElementById('modal-no').onclick  = () => { modal.style.display = 'none'; performSave(name, 'save_new'); };
    }

    function performSave(name, action) {
        fetch('/project/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, action }),
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                window.location.replace('/dashboard');
            } else {
                alert('Error: ' + (data.error || 'Unknown error'));
            }
        });
    }

    // ── Data Story ─────────────────────────────────────────
    function saveCurrentViewToStory() {
        const title    = prompt('Title for this story point:');
        if (!title) return;
        const insights = prompt('Notes or insights for this view:');
        const config   = {
            chartType: document.getElementById('chartType').value,
            xAxis:     document.getElementById('xAxis').value,
            yAxis:     document.getElementById('yAxis').value,
        };
        fetch('/story/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, insights, config }),
        })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                const li = document.createElement('li');
                li.className = 'list-group-item list-group-item-action';
                li.style.cursor = 'pointer';
                li.innerHTML = `<i class="fas fa-bookmark me-2 text-primary"></i>${title}`;
                document.getElementById('storyList').appendChild(li);
            }
        });
    }

    // ── AI Insights ────────────────────────────────────────
    function fetchAiInsights() {
        const container = document.getElementById('aiInsightsContainer');
        const content   = document.getElementById('aiInsightsContent');
        if (!container || !content) return;

        container.style.display = 'block';
        content.innerHTML = '<span class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i> Analysing…</span>';

        fetch('/ai-insights', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chart_config: lastChartConfig }),
        })
        .then(r => r.json())
        .then(data => {
            content.innerHTML = data.insights
                ? `<i class="fas fa-robot me-1 text-primary"></i>${data.insights}`
                : '<span class="text-danger">Could not generate insights.</span>';
        });
    }

    // ── Ask My Data ────────────────────────────────────────
    const askDataBtn   = document.getElementById('askDataBtn');
    const askDataInput = document.getElementById('askDataInput');
    if (askDataBtn && askDataInput) {
        askDataBtn.addEventListener('click', () => {
            const q = askDataInput.value.trim();
            if (!q) { alert('Please enter a question.'); return; }

            const spinner = document.getElementById('askSpinner');
            askDataBtn.disabled = true;
            if (spinner) spinner.classList.remove('d-none');

            fetch('/ask-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: q }),
            })
            .then(r => r.json())
            .then(data => {
                if (data.error) { alert('Error: ' + data.error); return; }

                const container = document.getElementById('kpiCardContainer');
                const card      = document.getElementById('kpiCard');
                document.getElementById('kpiTitle').textContent    = data.title;
                document.getElementById('kpiValue').textContent    = data.value;
                document.getElementById('kpiLabel').textContent    = data.label;
                document.getElementById('kpiSubtitle').textContent = data.subtitle;
                document.getElementById('kpiIcon').className = `fas ${data.icon}`;
                card.style.setProperty('--kpi-color', data.color || '#3b82f6');
                container.style.display = 'block';
                container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            })
            .finally(() => {
                askDataBtn.disabled = false;
                if (spinner) spinner.classList.add('d-none');
            });
        });

        askDataInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') askDataBtn.click();
        });
    }

    // ── PDF Export ─────────────────────────────────────────
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', () => {
            pdfSpinner && pdfSpinner.classList.remove('d-none');
            exportPdfBtn.disabled = true;

            generatePrimaryChart(true).then(() => {
                const insights = document.getElementById('aiInsightsContent')?.textContent || '';
                const xAxis    = document.getElementById('xAxis').value;
                const yAxis    = document.getElementById('yAxis').value;

                fetch('/export/pdf', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chart_config:  { x_axis: xAxis, y_axis: yAxis },
                        insights:      insights || `${yAxis} by ${xAxis}`,
                        title:         `${yAxis} by ${xAxis} Report`,
                    }),
                })
                .then(r => {
                    if (!r.ok) throw new Error('PDF export failed');
                    return r.blob();
                })
                .then(blob => {
                    const url  = window.URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.href     = url;
                    a.download = 'Report.pdf';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                })
                .catch(e => alert('Export failed: ' + e))
                .finally(() => {
                    pdfSpinner && pdfSpinner.classList.add('d-none');
                    exportPdfBtn.disabled = false;
                });
            });
        });
    }

    // ── Wire up buttons ─────────────────────────────────────
    createChartBtn.addEventListener('click', () => generatePrimaryChart());
    if (saveProjectBtn)   saveProjectBtn.addEventListener('click', saveProject);
    if (forecastBtn)      forecastBtn.addEventListener('click', applyForecast);
    if (addToStoryBtn)    addToStoryBtn.addEventListener('click', saveCurrentViewToStory);
    if (getAiInsightsBtn) getAiInsightsBtn.addEventListener('click', fetchAiInsights);
    if (clearFilterBtn) {
        clearFilterBtn.addEventListener('click', () => {
            if (myChart2) { myChart2.destroy(); myChart2 = null; }
            const t2 = document.getElementById('chart2-title');
            if (t2) t2.textContent = 'Click any bar, slice, or data point to drill down here.';
            clearFilterBtn.classList.add('d-none');
        });
    }

    // ── Listen for story-chart reload event ────────────────
    document.addEventListener('loadStoryChart', () => generatePrimaryChart());
});
