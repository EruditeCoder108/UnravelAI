document.getElementById('calcBtn').addEventListener('click', () => {
    const subtotal = document.getElementById('subtotal').value;
    const tipPct = parseFloat(document.getElementById('tipPct').value);

    // This operation implicitly coerces `subtotal` string into a Number because missing * operates on numbers
    const tipAmount = subtotal * tipPct;

    const total = subtotal + tipAmount;

    document.getElementById('totalResult').innerText = `Total: $${total}`;
});
