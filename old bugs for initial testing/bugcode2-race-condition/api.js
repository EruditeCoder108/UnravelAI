// Simulated backend API with artificial network delay
let serverBalance = 100;

function logAction(msg) {
    const logEl = document.getElementById('log');
    if (logEl) {
        logEl.innerHTML = `<div>[API] ${msg}</div>` + logEl.innerHTML;
    }
}

export const api = {
    // Fetches current balance from server (takes 600ms)
    fetchBalance: async () => {
        logAction('Fetching balance...');
        return new Promise(resolve => {
            setTimeout(() => {
                resolve(serverBalance);
            }, 600);
        });
    },

    // Updates balance on server (takes 400ms)
    updateBalance: async (newBalance) => {
        logAction(`Updating balance to $${newBalance}...`);
        return new Promise(resolve => {
            setTimeout(() => {
                serverBalance = newBalance;
                logAction(`Balance successfully saved as $${serverBalance}`);
                resolve(serverBalance);
            }, 400);
        });
    }
};
