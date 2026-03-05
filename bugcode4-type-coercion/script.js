document.getElementById('calcBtn').addEventListener('click', () => {
    // BUG: .value always returns a string from DOM elements
    const subtotal = document.getElementById('subtotal').value;
    const tipPct = parseFloat(document.getElementById('tipPct').value);

    // This operation implicitly coerces `subtotal` string into a Number because missing * operates on numbers
    const tipAmount = subtotal * tipPct;

    // BUG: Here, because `subtotal` is still a string, the + operator concatenates instead of adding.
    // Example: "50.00" (string) + 7.5 (number) = "50.007.5"
    const total = subtotal + tipAmount;

    document.getElementById('totalResult').innerText = `Total: $${total}`;
});
