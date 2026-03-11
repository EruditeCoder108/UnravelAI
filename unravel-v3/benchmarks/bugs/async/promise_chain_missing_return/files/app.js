function processOrder(orderId) {
    return fetchOrder(orderId)
        .then(order => {
            validateOrder(order);
        })
        .then(validatedOrder => {
            return saveOrder(validatedOrder);
        })
        .then(() => {
            console.log('Order saved');
        });
}

function fetchOrder(id) {
    return Promise.resolve({ id, items: ['book', 'pen'] });
}

function validateOrder(order) {
    return Promise.resolve({ ...order, validated: true });
}

function saveOrder(order) {
    return Promise.resolve(order);
}
