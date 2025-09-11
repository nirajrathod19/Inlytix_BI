document.addEventListener('DOMContentLoaded', function() {
    const chartTypeSelect = document.getElementById('chartType');
    if (!chartTypeSelect) {
        return; // Stop if the element for the chart builder page doesn't exist
    }

    // This list maps user-friendly labels to the specific values your backend expects.
    const allChartTypes = [
        { value: 'bar', label: 'Bar Chart' },
        { value: 'line', label: 'Line Chart' },
        { value: 'pie', label: 'Pie (Donut) Chart' },
        { value: 'doughnut', label: 'Doughnut Chart' },
        { value: 'scatter', label: 'Scatter Plot' },
        { value: 'table', label: 'Table' },
        { value: 'treemap', label: 'Treemap' },
        // Add any other charts from your complete list here
        // e.g., { value: 'heatmap', label: 'Heatmap' }
    ].sort((a, b) => a.label.localeCompare(b.label)); // Alphabetize the list

    const RECENTLY_USED_KEY = 'Etlytix_recently_used_charts';
    const MAX_RECENT = 5;

    const getRecentlyUsed = () => JSON.parse(localStorage.getItem(RECENTLY_USED_KEY)) || [];

    const addRecentlyUsed = (chart) => {
        let recent = getRecentlyUsed().filter(c => c.value !== chart.value);
        recent.unshift(chart);
        if (recent.length > MAX_RECENT) recent.pop();
        localStorage.setItem(RECENTLY_USED_KEY, JSON.stringify(recent));
    };

    // Initialize Choices.js
    const choices = new Choices(chartTypeSelect, {
        searchEnabled: true,
        itemSelectText: 'Select',
        shouldSort: false,
    });

    const populateChartDropdown = () => {
        choices.clearStore();
        const recentlyUsed = getRecentlyUsed();
        const choiceGroups = [];

        if (recentlyUsed.length > 0) {
            choiceGroups.push({
                label: 'Recently Used',
                disabled: true,
                choices: recentlyUsed
            });
        }
        choiceGroups.push({
            label: 'All Charts',
            disabled: true,
            choices: allChartTypes
        });
        choices.setChoices(choiceGroups, 'value', 'label', false);
    };

    populateChartDropdown();

    // --- CHART GENERATION LOGIC (Moved from main.js) ---
    const createChartBtn = document.getElementById('createChartBtn');
    const xAxisSelect = document.getElementById('xAxis');
    const yAxisSelect = document.getElementById('yAxis');
    let myChart = null; // Variable to hold the chart instance

    createChartBtn.addEventListener('click', function() {
        const selectedChartType = choices.getValue(true); // Get value from Choices.js
        const xAxis = xAxisSelect.value;
        const yAxis = yAxisSelect.value;

        if (!selectedChartType || !xAxis || !yAxis) {
            alert('Please select a chart type, X-Axis, and Y-Axis.');
            return;
        }
        
        // Find the selected chart object to add to "Recently Used"
        const selectedChartObject = allChartTypes.find(c => c.value === selectedChartType);
        if(selectedChartObject) {
           addRecentlyUsed(selectedChartObject);
           populateChartDropdown(); // Refresh dropdown to show recent item
        }

        const chartConfig = {
            chart_type: selectedChartType,
            x_axis: xAxis,
            y_axis: yAxis
        };

        // Fetch data and render chart
        fetch('/get-chart-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chartConfig)
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                console.error('Chart Error:', data.error);
                alert(`Error generating chart: ${data.error}`);
                return;
            }

            const chartContainer = document.getElementById('chart-container');
            const canvas = document.getElementById('myChart');
            
            // Destroy previous chart instance if it exists
            if (myChart) {
                myChart.destroy();
            }

            // Create the new chart
            myChart = new Chart(canvas, {
                type: selectedChartType, // 'bar', 'line', etc.
                data: {
                    labels: data.chart_data.map(item => item.key),
                    datasets: [{
                        label: `${yAxis} by ${xAxis}`,
                        data: data.chart_data.map(item => item.value),
                        backgroundColor: 'rgba(54, 162, 235, 0.6)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true
                        }
                    }
                }
            });
        })
        .catch(error => {
            console.error('Primary Chart Error:', error);
        });
    });
});