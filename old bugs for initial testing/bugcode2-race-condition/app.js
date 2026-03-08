import { api } from './api.js';

const balanceDisplay = document.getElementById('balanceDisplay');
const btn10 = document.getElementById('add10');
const btn50 = document.getElementById('add50');

async function syncUI() {
    const current = await api.fetchBalance();
    balanceDisplay.textContent = `$${current}`;
}

async function addFundsBuggy(amount) {
    // 1. Fetch current balance
    const currentBalance = await api.fetchBalance();

    // 2. Add new amount to what was fetched
    const newBalance = currentBalance + amount;

    // 3. Save new total back to server
    await api.updateBalance(newBalance);

    // 4. Update UI
    await syncUI();
}

btn10.addEventListener('click', () => addFundsBuggy(10));
btn50.addEventListener('click', () => addFundsBuggy(50));

syncUI();
