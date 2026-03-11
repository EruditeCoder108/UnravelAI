function calculateTotal(items) {
  let total = 0;

  items.forEach(item => {
    // item.price comes from a text input — it's a string
    total = total + item.price; // line 11 — BUG: string + number = concatenation
  });

  return total;
}

// Usage
const cartItems = [
  { name: 'Coffee', price: document.getElementById('price1').value }, // "5"
  { name: 'Muffin', price: 3 },
];

const total = calculateTotal(cartItems);
document.getElementById('total').textContent = '$' + total;
// Expected: $8
// Actual: $53  (string "5" + number 3 = "53")
