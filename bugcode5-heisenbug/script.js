const dataDisplay = document.getElementById('dataDisplay');
const statusMessage = document.getElementById('statusMessage');

// Simulated fast local cache (takes 5ms)
async function fetchAccountSettings() {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve({ theme: 'dark', notifications: true });
        }, 5);
    });
}

// Simulated network API (takes 10ms)
async function fetchUserProfile() {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve({ id: 101, name: 'Alice' });
        }, 10);
    });
}

let finalDashboardData = {};

async function initializeDashboard() {
    statusMessage.textContent = "Initializing...";
    statusMessage.className = "status";
    finalDashboardData = {};



    fetchAccountSettings().then(settings => {
        // UNCOMMENTING THE LINE BELOW FIXES THE BUG ENTIRELY 
        // console.log("Account settings arrived:", JSON.stringify(settings, null, 2));

        // console.log("Account settings arrived:", JSON.stringify(settings, null, 2));

        finalDashboardData = { ...finalDashboardData, ...settings };
        renderData();
    });

    fetchUserProfile().then(profile => {
        finalDashboardData = { ...finalDashboardData, ...profile };
        renderData();
    });
}

function renderData() {
    dataDisplay.textContent = JSON.stringify(finalDashboardData, null, 2);

    // Check if it's correct
    if (finalDashboardData.name && finalDashboardData.theme) {
        statusMessage.textContent = "Success: Both chunks loaded!";
        statusMessage.className = "status correct";
    } else {
        statusMessage.textContent = "Error: Data missing! Race condition occurred.";
        statusMessage.className = "status error";
    }
}

document.getElementById('runBtn').addEventListener('click', () => {
    initializeDashboard();
});
