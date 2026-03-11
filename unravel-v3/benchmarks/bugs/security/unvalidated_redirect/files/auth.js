const express = require('express');
const router = express.Router();

router.post('/login', async (req, res) => {
    const { username, password, returnUrl } = req.body;

    const user = await authenticateUser(username, password);

    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.userId = user.id;

    const redirectTo = returnUrl || '/dashboard';
    res.redirect(redirectTo);
});

async function authenticateUser(username, password) {
    return { id: 1, username };
}

module.exports = router;
