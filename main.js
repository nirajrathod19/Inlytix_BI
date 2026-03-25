const Fuse = require('fuse.js');

// Sample data for searching
const projects = [...]; // Array of project names
const columns = [...];  // Array of column names
const storyPoints = [...]; // Array of story point titles

// Initialize Fuse.js for fuzzy searching
const fuseOptions = {
    includeScore: true,
    threshold: 0.3,
    keys: ['name'] // Adjust based on your data structure
};

const fuseProjects = new Fuse(projects, fuseOptions);
const fuseColumns = new Fuse(columns, fuseOptions);
const fuseStoryPoints = new Fuse(storyPoints, fuseOptions);

// Command listener
function handleCommand(input) {
    if (input.startsWith('>')) {
        const command = input.slice(1).trim();

        switch (command) {
            case 'upload':
                // Redirect to upload route
                break;
            case 'clean':
                // Redirect to clean route
                break;
            default:
                // Fuzzy search enhancement
                let results = {};
                results.projects = fuseProjects.search(command);
                results.columns = fuseColumns.search(command);
                results.storyPoints = fuseStoryPoints.search(command);
                // Render or process results
                break;
        }
    }
}

// Example usage
handleCommand('>upload');
handleCommand('>search term'); // For fuzzy matching
