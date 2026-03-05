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

    // BUG: The developer started two async operations but didn't await them properly in order.
    // They are racing to mutate `finalDashboardData`.
    // Because setTimeout(5) happens before setTimeout(10), `settings` arrives first, then `profile`.
    // BUT the developer overwrites the object reference instead of merging!

    fetchAccountSettings().then(settings => {
        // UNCOMMENTING THE LINE BELOW FIXES THE BUG ENTIRELY 
        // console.log("Account settings arrived:", JSON.stringify(settings, null, 2));

        // Why? Because synchronous stringification + logging takes ~6-8ms in some older engines,
        // or just the act of observation shifts the microtask queue just enough so that 
        // fetchUserProfile completes first (or vice versa depending on exact engine timing).
        // This is a classic Heisenbug. Observation changes timing.

        finalDashboardData = { ...finalDashboardData, ...settings };
        renderData();
    });

    fetchUserProfile().then(profile => {
        // They should have merged, but they accidentally overwrote, OR they raced on a shallow copy.
        // Actually, let's make it a pure race condition on assignment.
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
