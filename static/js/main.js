// This function needs to be globally accessible for the onclick attribute in the HTML
function loadStoryPoint(pointId) {
    fetch(`/story/load/${pointId}`)
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert('Error: ' + data.error);
            return;
        }
        
        // Set the dropdowns to match the saved configuration
        document.getElementById('chartType').value = data.config.chartType;
        document.getElementById('xAxis').value = data.config.xAxis;
        document.getElementById('yAxis').value = data.config.yAxis;

        // Automatically regenerate the chart with the loaded settings
        // We need to trigger the function defined inside our DOMContentLoaded listener
        document.dispatchEvent(new CustomEvent('loadStoryChart'));

        // You could also display the saved title and insights somewhere on the page
        alert(`Loaded Story Point: ${data.title}\nInsights: ${data.insights}`);
    })
    .catch(error => console.error('Error loading story point:', error));
}


document.addEventListener('DOMContentLoaded', function () {
    // Make sure jsPDF is loaded
    if (typeof window.jspdf === 'undefined') {
        console.error("jsPDF not loaded!");
        return;
    }
    const { jsPDF } = window.jspdf;

    // --- VARIABLE DECLARATIONS ---
    let myChart = null;
    let myChart2 = null;
    let logoImg = null;

    // Define a color palette
    const CHART_COLORS = [
        'rgba(79, 70, 229, 0.8)', 'rgba(54, 162, 235, 0.8)', 
        'rgba(255, 206, 86, 0.8)', 'rgba(75, 192, 192, 0.8)', 
        'rgba(153, 102, 255, 0.8)', 'rgba(255, 159, 64, 0.8)',
        'rgba(255, 99, 132, 0.8)', 'rgba(107, 33, 168, 0.8)'
    ];

    // Pre-load logo for PDF header
    const logo = new Image();
    logo.src = '/static/img/logo.png';
    logo.onload = () => {
        logoImg = logo;
    };

    // --- HELPER FUNCTIONS ---
    function populateInsights(insights) {
        const table = document.getElementById('insightsTable');
        table.innerHTML = ''; // Clear previous insights
        const tbody = document.createElement('tbody');
        for (const [key, value] of Object.entries(insights)) {
            const row = tbody.insertRow();
            const cell1 = row.insertCell();
            const cell2 = row.insertCell();
            cell1.innerHTML = `<strong>${key}</strong>`;
            cell2.textContent = value;
        }
        table.appendChild(tbody);
    }

    function applyForecast() {
        if (!myChart || myChart.config.type !== 'line') {
            alert('Forecasting is only available for the primary Line Chart.');
            return;
        }

        const periods = document.getElementById('forecastPeriods').value;
        const xAxis = document.getElementById('xAxis').value;
        const yAxis = document.getElementById('yAxis').value;

        fetch('/get-forecast-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ x_axis: xAxis, y_axis: yAxis, periods: periods })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert('Forecast Error: ' + data.error);
                return;
            }

            // Remove any old forecast dataset before adding a new one
            if (myChart.data.datasets.length > 1) {
                myChart.data.datasets.pop();
                myChart.data.labels = myChart.data.labels.slice(0, -myChart.data.datasets[0].data.length);
            }

            // Create a new dataset for the forecast data
            const forecastDataset = {
                label: 'Forecast',
                data: data.values,
                borderColor: 'red',
                borderDash: [5, 5], // Dashed line for forecast
                fill: false,
                pointRadius: 4,
                backgroundColor: 'red'
            };

            // Add the new data to the existing chart
            myChart.data.datasets.push(forecastDataset);
            myChart.data.labels.push(...data.labels);
            myChart.update(); // Redraw the chart
        });
    }

    function saveProject() {
        const projectName = prompt("Please enter a name for your project:");
        if (!projectName) return; // User cancelled the prompt

        // 1. First, just check if the name exists
        fetch('/project/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: projectName, action: 'check' })
        })
        .then(response => response.json())
        .then(data => {
            if (data.exists) {
                // 2. If it exists, show our custom confirmation modal
                showReplaceModal(projectName);
            } else {
                // 3. If it does not exist, save it directly as a new project
                performSave(projectName, 'save_new');
            }
        })
        .catch(error => console.error('Error checking project:', error));
    }

    function showReplaceModal(projectName) {
        const modal = document.getElementById('replace-modal');
        document.getElementById('modal-text').textContent = `A project named "${projectName}" already exists. Do you want to replace it?`;
        modal.style.display = 'flex';

        // Wire up the "Yes" button to overwrite the project
        document.getElementById('modal-yes').onclick = () => {
            modal.style.display = 'none';
            performSave(projectName, 'overwrite');
        };

        // Wire up the "No" button to save it as a new, numbered project
        document.getElementById('modal-no').onclick = () => {
            modal.style.display = 'none';
            performSave(projectName, 'save_new');
        };
    }

    function performSave(projectName, action) {
        fetch('/project/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: projectName, action: action })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                // The server sends a flash message, so we just need to go to the dashboard
                window.location.replace('/dashboard');
            } else {
                alert('Error: ' + (data.error || 'An unknown error occurred.'));
            }
        })
        .catch(error => console.error('Save project error:', error));
    }

    // --- CHART GENERATION FUNCTIONS ---
    function generatePrimaryChart(isExport = false) {
        return new Promise((resolve, reject) => {
            // Step 1: Always read the CURRENT values from the UI controls.
            const chartType = document.getElementById('chartType').value;
            const xAxis = document.getElementById('xAxis').value;
            const yAxis = document.getElementById('yAxis').value;
            const animation = isExport ? { duration: 0 } : {};

            // Step 2: Send ALL current selections to the backend in the fetch request.
            // This is the crucial part that fixes the bug.
            fetch('/get-chart-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    x_axis: xAxis, 
                    y_axis: yAxis, 
                    chart_type: chartType // This ensures the selected chart type is always sent
                }),
            })
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    alert('Error: ' + data.error);
                    return reject(data.error);
                }
                
                // Step 3: Update insights and clear any old charts.
                populateInsights(data.insights);
                const ctx = document.getElementById('myChart').getContext('2d');
                if (myChart) myChart.destroy();
                if (myChart2) {
                    myChart2.destroy();
                    document.getElementById('chart2-title').textContent = 'Click on the primary chart to see details here.';
                }

                // Step 4: Prepare the data and options based on the chart type.
                let chartData, chartOptions;

                if (chartType === 'scatter') {
                    chartData = {
                        datasets: [{
                            label: `${yAxis} vs. ${xAxis}`,
                            data: data.chart_data, // Expects [{x:_, y:_}, ...]
                            backgroundColor: 'rgba(79, 70, 229, 0.8)',
                        }]
                    };
                    chartOptions = {
                        animation,
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: { type: 'linear', position: 'bottom', title: { display: true, text: xAxis } },
                            y: { title: { display: true, text: yAxis } }
                        }
                    };
                } else {
                    // Logic for bar, line, pie charts
                    const backgroundColors = (chartType === 'bar' || chartType === 'pie' || chartType === 'doughnut')
                        ? data.chart_data.map((_, i) => CHART_COLORS[i % CHART_COLORS.length])
                        : 'rgba(79, 70, 229, 0.8)';
                    
                    chartData = {
                        labels: data.chart_data.map(d => d.key),
                        datasets: [{
                            label: yAxis,
                            data: data.chart_data.map(d => d.value),
                            backgroundColor: backgroundColors,
                            borderColor: 'rgb(79, 70, 229)',
                            borderWidth: chartType === 'line' ? 2.5 : 1,
                        }]
                    };
                    chartOptions = {
                        animation,
                        responsive: true,
                        maintainAspectRatio: false,
                        onClick: (event, elements) => {
                            if (elements.length > 0) {
                                const clickedIndex = elements[0].index;
                                const clickedLabel = myChart.data.labels[clickedIndex];
                                generateFilteredChart(xAxis, clickedLabel);
                            }
                        },
                        scales: (chartType === 'bar' || chartType === 'line') ? { y: { beginAtZero: true } } : {}
                    };
                }

                // Step 5: Create the new chart with the correct type, data, and options.
                myChart = new Chart(ctx, {
                    type: chartType,
                    data: chartData,
                    options: chartOptions
                });

                setTimeout(() => resolve(), 500); // Wait for render to complete.
            }).catch(error => {
                console.error('Primary Chart Error:', error);
                reject(error);
            });
        });
    }


    function generateFilteredChart(filterColumn, filterValue) {
        if (!secondaryXAxis) { secondaryXAxis = filterColumn; }

        const secondaryXAxis = document.getElementById('secondaryXAxis').value;
        const secondaryChartType = document.getElementById('secondaryChartType').value;
    
        const yAxis = document.getElementById('yAxis').value;
        document.getElementById('chart2-title').textContent = `Details for ${filterValue}`;

        fetch('/get-chart-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                x_axis: secondaryXAxis,
                y_axis: yAxis,
                filter_col: filterColumn,
                filter_val: filterValue,
                chart_type: secondaryChartType
            }),
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) { alert('Filtered Chart Error: ' + data.error); return; }

            const ctx2 = document.getElementById('myChart2').getContext('2d');
            if (myChart2) myChart2.destroy();
            
            const backgroundColors = data.chart_data.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

            myChart2 = new Chart(ctx2, {
                type: secondaryChartType, // Use the selected chart type
                data: {
                    labels: data.chart_data.map(d => d.key),
                    datasets: [{
                        label: `${yAxis} for ${filterValue}`,
                        data: data.chart_data.map(d => d.value),
                        backgroundColor: backgroundColors,
                    }]
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: secondaryChartType !== 'pie' // Hide legend for pie chart
                        }
                    }
                }
            });
        }).catch(error => console.error('Filtered Chart Error:', error));
    }

    // --- STORYTELLING FUNCTIONS ---
    function saveCurrentViewToStory() {
        const title = prompt("Enter a title for this story point:");
        if (!title) return;

        const insights = prompt("Add any notes or insights for this view:");
        const config = {
            chartType: document.getElementById('chartType').value,
            xAxis: document.getElementById('xAxis').value,
            yAxis: document.getElementById('yAxis').value
        };

        fetch('/story/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, insights, config })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert(data.message);
                window.location.reload();
            } else {
                alert('Error: ' + data.error);
            }
        });
    }

    // --- PDF EXPORT FUNCTION ---
    async function handleComprehensivePdfExport() {
        const dashboardElement = document.getElementById('dashboard-content');
        if (!dashboardElement) return alert("Dashboard content not found.");
        if (numericColumns.length === 0 || categoricalColumns.length === 0) {
            return alert("Not enough numeric and categorical columns to generate a report.");
        }

        const pdfSpinner = document.getElementById('pdfSpinner');
        pdfSpinner.classList.remove('d-none');
        exportPdfBtn.disabled = true;

        const pdf = new jsPDF('landscape', 'pt', 'a4');
        const chartTypesToExport = ['bar', 'line', 'pie'];
        let isFirstPage = true;

        for (const category of categoricalColumns) {
            for (const metric of numericColumns) {
                for (const type of chartTypesToExport) {
                    document.getElementById('xAxis').value = category;
                    document.getElementById('yAxis').value = metric;
                    document.getElementById('chartType').value = type;

                    try {
                        await generatePrimaryChart(true);
                        const canvas = await html2canvas(dashboardElement, { scale: 3 });
                        const imgData = canvas.toDataURL('image/png');

                        if (!isFirstPage) pdf.addPage();

                        const pdfWidth = pdf.internal.pageSize.getWidth();
                        const margin = 40;
                        const contentWidth = pdfWidth - margin * 2;
                        
                        if (logoImg) pdf.addImage(logoImg, 'PNG', pdfWidth - margin - 30, margin - 15, 30, 30);
                        pdf.setFontSize(10);
                        pdf.text("Inlytix BI", pdfWidth - margin - 100, margin);
                        pdf.setFontSize(16);
                        pdf.text(`${metric} by ${category} (${type} chart)`, margin, margin + 20);
                        
                        const imgProps = pdf.getImageProperties(imgData);
                        const imgHeight = (imgProps.height * contentWidth) / imgProps.width;
                        pdf.addImage(imgData, 'PNG', margin, margin + 40, contentWidth, imgHeight);

                        isFirstPage = false;
                    } catch (error) {
                        console.error(`Skipping chart due to error: ${metric} by ${category} (${type}). Reason:`, error.message);
                    }
                }
            }
        }
        
        pdf.save(`Inlytix BI-Comprehensive-Report.pdf`);
        pdfSpinner.classList.add('d-none');
        exportPdfBtn.disabled = false;
    }

    // --- EVENT LISTENERS ---
    const createChartBtn = document.getElementById('createChartBtn');
    if (createChartBtn) {
        createChartBtn.addEventListener('click', () => generatePrimaryChart(false));
    }

    const exportPdfBtn = document.getElementById('exportPdfBtn');
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', handleComprehensivePdfExport);
    }

    const addToStoryBtn = document.getElementById('addToStoryBtn');
    if (addToStoryBtn) {
        addToStoryBtn.addEventListener('click', saveCurrentViewToStory);
    }

    const saveProjectBtn = document.getElementById('saveProjectBtn');
    if (saveProjectBtn) {
        saveProjectBtn.addEventListener('click', saveProject);
    }
    
    const forecastBtn = document.getElementById('forecastBtn');
    if (forecastBtn) {
        forecastBtn.addEventListener('click', applyForecast);
    }

    // When the Chart Type dropdown in the control panel changes, regenerate the chart.
    const chartTypeSelect = document.getElementById('chartType');
    if (chartTypeSelect) {
        chartTypeSelect.addEventListener('change', () => generatePrimaryChart(false));
    }

    const topChartTypeSelect = document.getElementById('topChartType');
    if (topChartTypeSelect) {
        topChartTypeSelect.addEventListener('change', () => {
            document.getElementById('chartType').value = topChartTypeSelect.value;
            generatePrimaryChart(false);
        });
    }

    // Custom event listener to re-render chart when a story point is loaded
    document.addEventListener('loadStoryChart', () => generatePrimaryChart(false));
});

function saveCurrentViewToStory() {
    const title = prompt("Enter a title for this story point:");
    if (!title) return; // User cancelled

    const insights = prompt("Add any notes or insights for this view:");

    // Capture the current state of the chart controls
    const config = {
        chartType: document.getElementById('chartType').value,
        xAxis: document.getElementById('xAxis').value,
        yAxis: document.getElementById('yAxis').value
    };

    fetch('/story/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, insights, config })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            alert(data.message);
            window.location.reload(); // Reload to show the new point in the list
        } else {
            alert('Error: ' + data.error);
        }
    });
}

// Added this entire function (make it globally accessible)
function loadStoryPoint(pointId) {
    fetch(`/story/load/${pointId}`)
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert('Error: ' + data.error);
            return;
        }
        
        // Set the dropdowns to match the saved configuration
        document.getElementById('chartType').value = data.config.chartType;
        document.getElementById('xAxis').value = data.config.xAxis;
        document.getElementById('yAxis').value = data.config.yAxis;

        // Automatically regenerate the chart with the loaded settings
        generatePrimaryChart();

        // You could also display the saved title and insights somewhere on the page
        alert(`Loaded Story Point: ${data.title}\nInsights: ${data.insights}`);
    });
}
