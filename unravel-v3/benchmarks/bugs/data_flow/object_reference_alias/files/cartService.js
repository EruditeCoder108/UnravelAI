function createCart(userId) {
    return {
        userId,
        items: [],
        total: 0
    };
}

function applyPromotion(cart, promotionCart) {
    promotionCart.items = cart.items;
    promotionCart.total = cart.total * 0.9;
    return promotionCart;
}

const userCart = createCart(1);
userCart.items.push({ name: 'Book', price: 20 });
userCart.total = 20;

const promoCart = createCart(1);
const discountedCart = applyPromotion(userCart, promoCart);

userCart.items.push({ name: 'Pen', price: 5 });
console.log(discountedCart.items.length);
