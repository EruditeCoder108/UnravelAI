// Bug 06: TYPE_COERCION — Implicit string-to-number coercion in calculation
// Difficulty: Easy

export const metadata = {
    id: 'type_coercion_calc',
    bugCategory: 'TYPE_COERCION',
    userSymptom: 'Shopping cart total shows "53" instead of 8 when adding a $5 item and a $3 item.',
    trueRootCause: 'Price from DOM input is a string "5". The + operator concatenates instead of adding: "5" + 3 = "53".',
    trueVariable: 'total',
    trueFile: 'bug06_type_coercion.js',
    trueLine: 11,
    difficulty: 'easy',
};

export const code = `
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
`;
