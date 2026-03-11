// Global function for story-point loading (called via inline onclick)
function loadStoryPoint(pointId) {
    fetch(`/story/load/${pointId}`)
    .then(r => r.json())
    .then(data => {
        if (data.error) { alert('Error: ' + data.error); return; }
        const ct = document.getElementById('chartType');
        const xa = document.getElementById('xAxis');
        const ya = document.getElementById('yAxis');
        if (ct) ct.value = data.config.chartType;
        if (xa) xa.value = data.config.xAxis;
        if (ya) ya.value = data.config.yAxis;
        document.dispatchEvent(new CustomEvent('loadStoryChart'));
    })
    .catch(err => console.error('Error loading story point:', err));
}

document.addEventListener('DOMContentLoaded', function () {

    // ── Sidebar ──────────────────────────────────────────────
    const sidebar          = document.getElementById('global-project-sidebar');
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebarCloseBtn  = document.getElementById('sidebar-close-btn');
    const sidebarOverlay   = document.getElementById('sidebar-overlay');
    const projectListContainer = document.getElementById('sidebar-project-list');
    const loadProjectActionCard = document.getElementById('load-project-action');

    function openSidebar() {
        fetch('/projects/list')
        .then(r => r.json())
        .then(projects => {
            if (!projectListContainer) return;
            projectListContainer.innerHTML = '';
            if (projects && projects.length > 0) {
                projects.forEach(p => {
                    const a = document.createElement('a');
                    a.href = `/project/load/${p.id}`;
                    a.textContent = p.name;
                    projectListContainer.appendChild(a);
                });
            } else {
                projectListContainer.innerHTML = '<p class="text-muted p-3">No projects found.</p>';
            }
        });
        if (sidebar)       sidebar.classList.add('active');
        if (sidebarOverlay) sidebarOverlay.classList.add('active');
    }

    function closeSidebar() {
        if (sidebar)       sidebar.classList.remove('active');
        if (sidebarOverlay) sidebarOverlay.classList.remove('active');
    }

    if (sidebarToggleBtn)    sidebarToggleBtn.addEventListener('click', openSidebar);
    if (loadProjectActionCard) loadProjectActionCard.addEventListener('click', e => { e.preventDefault(); openSidebar(); });
    if (sidebarCloseBtn)     sidebarCloseBtn.addEventListener('click', closeSidebar);
    if (sidebarOverlay)      sidebarOverlay.addEventListener('click', closeSidebar);

    // ── DB Connection Form ───────────────────────────────────
    const generateSqlBtn  = document.getElementById('generate-sql-btn');
    const dbConnectionForm = document.getElementById('db-connection-form');

    if (generateSqlBtn) {
        generateSqlBtn.addEventListener('click', () => {
            const naturalQuery = document.getElementById('natural_language_query').value;
            const aiSpinner    = document.getElementById('ai-spinner');
            if (!naturalQuery) { alert('Please ask a question first.'); return; }
            if (aiSpinner) aiSpinner.classList.remove('d-none');

            fetch('/generate-sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: naturalQuery }),
            })
            .then(r => r.json())
            .then(data => {
                if (data.sql_query) document.getElementById('sql_query').value = data.sql_query;
            })
            .finally(() => { if (aiSpinner) aiSpinner.classList.add('d-none'); });
        });
    }

    if (dbConnectionForm) {
        dbConnectionForm.addEventListener('submit', event => {
            event.preventDefault();
            const details = {
                host:     document.getElementById('db_host').value,
                name:     document.getElementById('db_name').value,
                user:     document.getElementById('db_user').value,
                password: document.getElementById('db_pass').value,
                query:    document.getElementById('sql_query').value,
            };
            fetch('/data/from_db', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(details),
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    window.location.href = '/prepare';
                } else {
                    alert('Error fetching data: ' + data.error);
                }
            });
        });
    }
});
